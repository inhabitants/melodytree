// O motor da árvore de busca, sem DOM e sem Web Audio: recebe o estado do som (S, o
// mesmo de som.js) a cada passo e pinta em qualquer tela. A página ao vivo
// (arvore.js), o render do vídeo (render-arvore.js) e o site público usam o mesmo.
//
// 1. Três vozes: o raio principal ouve o grave, o secundário o médio, o terciário o
//    agudo, cada um num galho grande diferente e com lugar garantido no feixe.
// 2. A forma da música: energia dos últimos 0,8 s contra a dos últimos 8 s. Subiu
//    (refrão) o feixe abre e a câmera se afasta; desceu (verso) fecha e aproxima;
//    quase sumiu com a música tocando (quebra) a busca segura e a câmera respira.
// 3. O caminho que a música escolheu: o trajeto do raio principal fica gravado; na
//    vista "assinatura" a câmera recua e mostra a faixa inteira.
// 4. Profundidade: a busca cresce também pra dentro da tela e a câmera orbita
//    devagar (só com música). Desligar achata a cena em 1 s, sem corte.
//
// Regra das páginas ao vivo: a música é o motor. Tudo que anda multiplica por
// S.presenca; sem som a cena para onde está, e nada reinicia do zero.

const SILENCIO = { nivel: 0, pulso: 0, batidas: 0, altura: 220, bandas: new Float32Array(8), ataques: new Float32Array(8), rms: 0, presenca: 0, bpm: 120 };

// `aleatorio` troca o Math.random por um gerador com semente: mesma semente e mesma
// música, mesma árvore (no render offline, onde o relógio também é fixo)
export function criarArvore({ feixe = 28, profundidade = true, aleatorio = Math.random, idioma = "pt", marca = null } = {}) {
  const config = { feixe, profundidade, idioma, marca };
  const tela = { W: 1920, H: 1080 };
  let S = SILENCIO;
  const uni = (a, b) => a + (b - a) * aleatorio();
  const gauss = () => Math.sqrt(-2 * Math.log(aleatorio() + 1e-12)) * Math.cos(2 * Math.PI * aleatorio());

  const MEIA_A = 4, PASSO_L = 0.8, ABERTURA = 0.38, TETO_ANGULO = 1.1;
  const COS_TETO = Math.cos(TETO_ANGULO), SEN_TETO = Math.sin(TETO_ANGULO);
  const MEMORIA_NIVEIS = 34;              // arestas e linhagens lembram até aqui pra trás
  const MARGEM_TROCA = 2.0;               // um galho só toma o lugar de outro raio com essa vantagem
  const SEPARACOES = [6, 4, 2, 1];        // galho novo de raio: longe dos de cima (relaxa se não houver)
  const PROTEGIDOS = 2;                   // filhos de cada raio com lugar garantido no feixe
  const LUZ_SLOT = [1, 0.62, 0.42], LUZ_S = 0.5;
  const VOZES = [{ nome: "grave", bandas: [0, 1] }, { nome: "médio", bandas: [3, 4] }, { nome: "agudo", bandas: [6, 7] }];
  const DIST = 9;                         // distância da câmera ao foco (perspectiva)

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const suave = (dt, tau) => 1 - Math.exp(-dt / tau);

  const raiz = { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, score: 0, pai: null, j: 0, d: 0 };
  const estado = {
    feixe: [raiz], crescendo: [], tocos: [], arestas: [],
    frac: 0, nivel: 0, batidasNoNivel: 0, batidasVistas: 0, vento: 0,
    raios: [], pontas: [], fantasmas: [], trocas: 0, promocoes: 0, principalTrocou: true, foco: null,
  };
  const cam = { x: 0, y: 1.6, zc: 0, z: 1, giro: 0, yaw: 0, pz: 1 };
  const vozes = VOZES.map(() => ({ nivel: 0, pulso: 0 }));
  const forma = { curta: 0, longa: 0, I: 0, segura: 0, viva: false };
  const caminho = { segmentos: [], faixa: "", tocado: 0 };
  const vista = { modo: "vivo" };

  // ---------------- a busca ----------------
  const fatorFeixe = () => 2 ** (0.75 * forma.I);
  const fatorZoom = () => 2 ** (-0.45 * forma.I);
  const nomeForma = () => (forma.segura > 0.5 ? "segura" : forma.I > 0.3 ? "abre" : forma.I < -0.3 ? "fecha" : "anda");

  function ventoDaAltura(hz) {
    const v = (Math.log2(hz) - Math.log2(80)) / (Math.log2(1600) - Math.log2(80));
    return (clamp(v, 0, 1) - 0.5) * 1.3;
  }

  function expandir() {
    const K = Math.max(6, Math.round(config.feixe * fatorFeixe()));
    const filhos = estado.batidasNoNivel > 0 ? 3 : 2;
    const fundo = config.profundidade;
    const cand = [];
    for (const n of estado.feixe) {
      for (let f = 0; f < filhos; f++) {
        let dx = n.dx + gauss() * ABERTURA, dy = n.dy, dz = fundo ? n.dz + gauss() * ABERTURA * 0.8 : n.dz * 0.7;
        const m = Math.hypot(dx, dy, dz);
        dx /= m; dy /= m; dz /= m;
        if (dy < COS_TETO) { const h = Math.hypot(dx, dz) || 1; dx = (dx / h) * SEN_TETO; dz = (dz / h) * SEN_TETO; dy = COS_TETO; }
        const L = PASSO_L * uni(0.8, 1.15);
        const alinhamento = dx * Math.sin(estado.vento) + dy * Math.cos(estado.vento);
        cand.push({ x: n.x + L * dx, y: n.y + L * dy, z: n.z + L * dz, dx, dy, dz, pai: n, score: n.score + 0.8 * gauss() + 1.1 * alinhamento, j: gauss() * 0.06, d: n.d + 1 });
      }
    }
    cand.sort((a, b) => b.score - a.score);
    // os galhos dos três raios têm lugar garantido: sem isso o feixe colapsa num
    // galho só e as três vozes acabam encostadas uma na outra
    const vivos = new Set();
    for (const r of estado.raios) {
      if (!r) continue;
      let k = 0;
      for (const c of cand) if (c.pai === r) { vivos.add(c); if (++k >= PROTEGIDOS) break; }
    }
    for (const c of cand) { if (vivos.size >= K) break; vivos.add(c); }
    estado.crescendo = cand.filter((c) => vivos.has(c));
    estado.tocos = cand.filter((c) => !vivos.has(c));
    estado.batidasNoNivel = 0;
  }

  const ancestral = (n, k) => { let a = n; for (let i = 0; i < k && a.pai; i++) a = a.pai; return a; };

  // Cada raio segue o próprio galho e só troca se um caminho livre passar na frente
  // com folga. Perdeu o galho, quem tenta o lugar primeiro é o raio de baixo (promoção),
  // e o brilho cruza em LUZ_S. Galho NOVO precisa estar a SEPARACOES níveis dos de cima.
  function escolherRaios() {
    const antigos = estado.raios;
    const novos = [], raizes = [];
    const paiLivre = (n) => !novos.includes(n) && !novos.some((m) => m && m.pai === n.pai);
    const herdeiro = (pai) => {
      let melhor = null;
      for (const n of estado.crescendo) if (n.pai === pai && paiLivre(n) && (!melhor || n.score > melhor.score)) melhor = n;
      return melhor;
    };
    for (let slot = 0; slot < 3; slot++) {
      let desafiante = null;
      for (const dist of SEPARACOES) {
        const livre = (n) => paiLivre(n) && !raizes.some((r) => r.d <= dist && ancestral(n, r.d) === r.no);
        for (const n of estado.crescendo) if (livre(n) && (!desafiante || n.score > desafiante.score)) desafiante = n;
        if (desafiante) break;
      }
      const proprio = antigos[slot] && herdeiro(antigos[slot]);
      if (!desafiante && !proprio) { novos[slot] = null; continue; }
      const aguenta = (n) => n && (!desafiante || desafiante.score <= n.score + MARGEM_TROCA);
      let escolhido = aguenta(proprio) ? proprio : null;
      for (let de = slot + 1; !escolhido && de < 3; de++) {
        const promovido = antigos[de] && !novos.some((n) => n && n.pai === antigos[de]) && herdeiro(antigos[de]);
        if (aguenta(promovido)) { escolhido = promovido; if (slot === 0) estado.promocoes += 1; }
      }
      if (!escolhido) {
        escolhido = desafiante;
        escolhido.luz = 0; // galho novo acende do zero
        if (slot === 0 && antigos[0]) estado.trocas += 1;
      }
      if (escolhido.luz === undefined) escolhido.luz = escolhido.pai.luz ?? 0;
      if (slot === 0 && escolhido.pai !== antigos[0]) estado.principalTrocou = true;
      novos[slot] = escolhido;
      for (const d of [1, 2, 3, 4, 5, 6]) raizes.push({ d, no: ancestral(escolhido, d) });
    }
    for (const a of antigos) if (a && !novos.some((n) => n && n.pai === a)) estado.fantasmas.push(a);
    estado.raios = novos;
  }

  function completarNivel() {
    for (const n of estado.crescendo) estado.arestas.push({ x0: n.pai.x, y0: n.pai.y, z0: n.pai.z, x1: n.x, y1: n.y, z1: n.z, d: n.d });
    for (const n of estado.tocos) {
      const p = n.pai;
      estado.arestas.push({ x0: p.x, y0: p.y, z0: p.z, x1: p.x + (n.x - p.x) * 0.35, y1: p.y + (n.y - p.y) * 0.35, z1: p.z + (n.z - p.z) * 0.35, d: n.d });
    }
    estado.feixe = estado.crescendo;
    estado.nivel += 1;
    for (const n of estado.feixe) ancestral(n, MEMORIA_NIVEIS).pai = null;
    const limite = estado.nivel - MEMORIA_NIVEIS;
    if (estado.arestas.length && estado.arestas[0].d < limite) estado.arestas = estado.arestas.filter((e) => e.d >= limite);
    expandir();
    escolherRaios();
  }
  expandir();
  escolherRaios();

  // ---------------- a escuta: três vozes e a forma ----------------
  function ouvir(dt) {
    const s = S;
    VOZES.forEach((v, i) => {
      const z = vozes[i];
      z.nivel += ((s.bandas[v.bandas[0]] + s.bandas[v.bandas[1]]) / 2 - z.nivel) * suave(dt, 0.08);
      // o ataque vem do fluxo da banda (S.ataques), não do nível: em música densa a banda vive
      // saturada perto de 1 e o bumbo some dentro dela. Grave = bumbo e baixo, agudo = chimbal
      const ataque = Math.max(s.ataques[v.bandas[0]], s.ataques[v.bandas[1]]) * s.presenca;
      z.pulso = Math.max(ataque, z.pulso * Math.exp(-dt / 0.22));
    });
    if (s.presenca < 0.05) { forma.segura += (0 - forma.segura) * suave(dt, 0.35); return; }
    // volume CRU (S.rms): o nível normalizado se adapta em 6 s e apagaria a diferença entre refrão e verso
    if (!forma.viva) { forma.curta = forma.longa = s.rms; forma.viva = true; }
    forma.curta += (s.rms - forma.curta) * suave(dt, 0.8);
    forma.longa += (s.rms - forma.longa) * suave(dt, 8);
    const razao = forma.curta / (forma.longa + 1e-4);
    forma.razao = razao;
    forma.I += (clamp((razao - 1) / 0.3, -1, 1) - forma.I) * suave(dt, 1.5);
    forma.segura += ((razao < 0.45 ? 1 : 0) - forma.segura) * suave(dt, 0.35);
  }

  // ---------------- o passo ----------------
  let relogio = 0;
  function passo(dt, som, tocando = som.presenca > 0.05) {
    S = som;
    const s = S;
    relogio += dt;
    ouvir(dt);
    const batidaNova = s.batidas > estado.batidasVistas;
    estado.batidasVistas = s.batidas;
    if (batidaNova) estado.batidasNoNivel += 1;
    const anda = s.presenca * (1 - 0.85 * forma.segura);
    estado.frac += dt * anda * (0.45 + 1.2 * s.nivel) + (batidaNova ? 0.18 * anda : 0);
    while (estado.frac >= 1) { estado.frac -= 1; completarNivel(); }
    estado.vento += (ventoDaAltura(s.altura) - estado.vento) * clamp((dt * s.presenca) / 1.5, 0, 1);

    const kLuz = suave(dt, LUZ_S);
    estado.raios.forEach((n, i) => { if (n) n.luz += (LUZ_SLOT[i] - n.luz) * kLuz; });
    for (const fa of estado.fantasmas) fa.luz -= Math.max(kLuz * fa.luz, dt * 0.4);
    estado.fantasmas = estado.fantasmas.filter((fa) => fa.luz > 0.02);

    const f = estado.frac;
    estado.pontas = estado.raios.map((n) => n && { x: n.pai.x + (n.x - n.pai.x) * f, y: n.pai.y + (n.y - n.pai.y) * f, z: n.pai.z + (n.z - n.pai.z) * f });
    if (s.presenca > 0.05) gravarCaminho();
    if (tocando) caminho.tocado += dt;
    while (toques.length && relogio - toques[0].t0 > VIDA_TOQUE) toques.shift();
    camera(dt);
  }

  // ---------------- o toque: uma gota caindo no mar ----------------
  // Anéis achatados como água vista de lado abrem do ponto, e cada galho acende quando o primeiro anel passa por
  // ele. Só o site chama; a bancada e o render não tocam. x e y em pixels da mesma tela que o pintar recebe.
  const toques = [];
  const VIDA_TOQUE = 2;
  const ACHATA = 0.32;                    // altura do anel sobre a largura: o mar visto de lado
  const ANEL_MAX = 60, ANEL_S = 1.5;      // raio final do primeiro anel (× esc) e quanto ele leva pra abrir
  const raioDoAnel = (u, k) => (6 + (ANEL_MAX - 6) * k) * (1 - (1 - u) ** 2.4);
  function tocar(x, y, tela, forca = 1) {
    const P = projetor(tela);
    const esc = Math.min(tela.W, tela.H) / 540;
    const R = ANEL_MAX * esc * 0.92;
    const a = { x: 0, y: 0, k: 1 }, b = { x: 0, y: 0, k: 1 };
    const perto = [];
    // a distância é medida no mesmo achatamento do anel: acende o que o anel cruza
    for (const e of estado.arestas) {
      P(e.x0, e.y0, e.z0, a); P(e.x1, e.y1, e.z1, b);
      const ay = a.y / ACHATA, by = b.y / ACHATA, py = y / ACHATA;
      const vx = b.x - a.x, vy = by - ay;
      const u = clamp(((x - a.x) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
      const d = Math.hypot(a.x + vx * u - x, ay + vy * u - py);
      if (d < R) perto.push({ e, d });
    }
    perto.sort((p, q) => p.d - q.d);
    // o atraso é o tempo que o primeiro anel leva pra chegar naquela distância
    const acesas = perto.slice(0, 160).map(({ e, d }) => {
      const f = Math.min(0.97, Math.max(0, d / esc - 6) / (ANEL_MAX - 6));
      return { e, atraso: ANEL_S * (1 - (1 - f) ** (1 / 2.4)) };
    });
    // respingos: três ou quatro gotinhas que sobem do ponto e caem de volta (Math.random e não o `aleatorio`,
    // pra o toque não mexer na semente da árvore)
    const respingos = Array.from({ length: 3 + Math.round(Math.random()) }, () => ({ vx: (Math.random() - 0.5) * 50, vy: 55 + Math.random() * 30 }));
    toques.push({ t0: relogio, x, y, forca, acesas, respingos });
    if (toques.length > 12) toques.shift();
    // os raios respiram junto, como numa batida
    for (const v of vozes) v.pulso = Math.max(v.pulso, 0.5 * forca);
    return acesas.length;
  }

  function pintarToques(g, P, esc, a, b) {
    for (const t of toques) {
      const idade = relogio - t.t0;
      for (const { e, atraso } of t.acesas) {
        const u = idade - atraso;
        if (u <= 0) continue;
        const luz = (u < 0.05 ? u / 0.05 : Math.exp(-(u - 0.05) / 0.4)) * t.forca;
        if (luz < 0.02) continue;
        P(e.x0, e.y0, e.z0, a); P(e.x1, e.y1, e.z1, b);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
        g.strokeStyle = `rgba(224, 88, 58, ${0.12 * luz})`; g.lineWidth = 5 * esc; g.stroke();
        g.strokeStyle = `rgba(236, 230, 218, ${0.7 * luz})`; g.lineWidth = 1.3 * esc; g.stroke();
      }
      const { x, y, forca } = t;
      // três anéis, um atrás do outro; a metade de trás (a de cima) mais fina e apagada, que é o que dá a perspectiva
      for (const [k, atraso] of [[1, 0], [0.8, 0.14], [0.62, 0.3]]) {
        const u = (idade - atraso) / ANEL_S;
        if (u <= 0 || u >= 1) continue;
        const r = raioDoAnel(u, k) * esc;
        const luz = 0.75 * k * (1 - u) ** 1.5 * forca;
        g.lineWidth = 0.8 * esc;
        g.strokeStyle = `rgba(236, 230, 218, ${luz * 0.45})`;
        g.beginPath(); g.ellipse(x, y, r, r * ACHATA, 0, Math.PI, 2 * Math.PI); g.stroke();
        g.lineWidth = 1.3 * esc;
        g.strokeStyle = `rgba(236, 230, 218, ${luz})`;
        g.beginPath(); g.ellipse(x, y, r, r * ACHATA, 0, 0, Math.PI); g.stroke();
      }
      // a aura pequena no ponto da queda: osso no miolo, um fio de brasa na borda
      const ua = idade / 0.7;
      if (ua < 1) {
        const ra = (5 + 9 * ua) * esc;
        const aura = g.createRadialGradient(x, y, 0, x, y, ra);
        aura.addColorStop(0, `rgba(236, 230, 218, ${0.55 * (1 - ua) * forca})`);
        aura.addColorStop(0.45, `rgba(224, 88, 58, ${0.18 * (1 - ua) * forca})`);
        aura.addColorStop(1, "rgba(224, 88, 58, 0)");
        g.fillStyle = aura;
        g.beginPath(); g.arc(x, y, ra, 0, 2 * Math.PI); g.fill();
      }
      // os respingos sobem e caem de volta na água (gravidade de 300 × esc por s²)
      const tt = idade - 0.03;
      if (tt > 0) {
        g.fillStyle = `rgba(236, 230, 218, ${0.8 * forca})`;
        for (const p of t.respingos) {
          const sobe = p.vy * tt - 150 * tt * tt;
          if (sobe < 0) continue;
          g.beginPath(); g.arc(x + p.vx * tt * esc, y - sobe * esc, 1.1 * esc, 0, 2 * Math.PI); g.fill();
        }
      }
    }
  }

  function gravarCaminho() {
    const p = estado.pontas[0];
    if (!p) return;
    if (estado.principalTrocou || !caminho.segmentos.length) { caminho.segmentos.push([]); estado.principalTrocou = false; }
    const seg = caminho.segmentos[caminho.segmentos.length - 1];
    const n = seg.length;
    if (!n || Math.hypot(p.x - seg[n - 3], p.y - seg[n - 2], p.z - seg[n - 1]) > 0.04) seg.push(p.x, p.y, p.z);
  }

  // caixa do caminho inteiro da faixa e o zoom que faz ele caber numa tela W×H
  function caixaDoCaminho() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const seg of caminho.segmentos) for (let i = 0; i < seg.length; i += 3) {
      x0 = Math.min(x0, seg[i]); x1 = Math.max(x1, seg[i]); y0 = Math.min(y0, seg[i + 1]); y1 = Math.max(y1, seg[i + 1]); z0 = Math.min(z0, seg[i + 2]); z1 = Math.max(z1, seg[i + 2]);
    }
    return x0 === Infinity ? null : { x0, x1, y0, y1, z0, z1 };
  }
  // A assinatura é um desenho plano (a câmera achata e para de orbitar), centrado no que sobra
  // da tela tirando a faixa de baixo, onde mora o rodapé: o raio não passa por cima do texto.
  function enquadrarAssinatura(w, h) {
    const c = caixaDoCaminho();
    if (!c) return null;
    const faixaRodape = (78 * (Math.min(w, h) / 540)) / h; // fração da altura que o rodapé ocupa
    const alturaUtil = 1 - faixaRodape;
    const meiaX = Math.max((c.x1 - c.x0) / 2, 0.5), meiaY = Math.max((c.y1 - c.y0) / 2, 0.5);
    // a meia altura do mundo é MEIA_A em qualquer tela; a meia largura é MEIA_A × a proporção dela
    const z = clamp(Math.min((MEIA_A * (w / h)) / (meiaX * 1.2), (MEIA_A * alturaUtil) / (meiaY * 1.08)), 0.01, 1.4);
    // sobe o centro meia faixa de rodapé: em unidades do mundo, 1 px vale 2·MEIA_A/(h·z)
    const subida = ((faixaRodape * h) / 2) * ((2 * MEIA_A) / (h * z));
    return { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 - subida, zc: (c.z0 + c.z1) / 2, z };
  }

  function camera(dt) {
    const s = S;
    const fundo = config.profundidade;
    const assinando = vista.modo === "assinatura";
    cam.pz += ((fundo && !assinando ? 1 : 0) - cam.pz) * suave(dt, 1);
    // a órbita só anda com música; sem profundidade, volta pro ângulo zero mais próximo
    if (fundo && !assinando) cam.yaw += dt * 0.06 * s.presenca * (0.4 + s.nivel);
    else cam.yaw += (Math.round(cam.yaw / (2 * Math.PI)) * 2 * Math.PI - cam.yaw) * suave(dt, 1);
    const meiaL = MEIA_A * (tela.W / tela.H);

    if (vista.modo === "assinatura") {
      // recua até caber o caminho inteiro da faixa
      const alvo = enquadrarAssinatura(tela.W, tela.H);
      if (!alvo) return;
      const k = suave(dt, 1.4);
      cam.x += (alvo.x - cam.x) * k;
      cam.y += (alvo.y - cam.y) * k;
      cam.zc += (alvo.zc - cam.zc) * k;
      cam.z += (alvo.z - cam.z) * k;
      cam.giro += (0 - cam.giro) * k;
      return;
    }

    // ao vivo: a média dos raios pesada pelo brilho (luz²), com quem está apagando ainda pesando
    let sx = 0, sy = 0, sz = 0, sp = 0;
    estado.pontas.forEach((pt, i) => { if (pt) { const w = estado.raios[i].luz ** 2 + 1e-4; sx += pt.x * w; sy += pt.y * w; sz += pt.z * w; sp += w; } });
    for (const fa of estado.fantasmas) { const w = fa.luz ** 2; sx += fa.x * w; sy += fa.y * w; sz += fa.z * w; sp += w; }
    if (sp > 0.05 || !estado.foco) estado.foco = { x: sx / sp, y: sy / sp, z: sz / sp };
    const foco = estado.foco;
    let espalho = 0;
    for (const n of estado.crescendo) espalho = Math.max(espalho, Math.hypot(n.x - foco.x, (n.z - foco.z) * cam.pz));
    const respiro = 1 + 0.025 * Math.sin(relogio * 2.2) * forma.segura;
    const alvoZ = clamp((meiaL / ((espalho + 1) * 1.25)) * fatorZoom(), 0.4, 1.6) * respiro;
    cam.x += (foco.x - cam.x) * suave(dt, 1.8);
    cam.zc += (foco.z - cam.zc) * suave(dt, 1.8);
    cam.y += (foco.y - (MEIA_A / cam.z) * 0.4 - cam.y) * suave(dt, 0.9);
    cam.z += (alvoZ - cam.z) * suave(dt, 2.2);
    cam.giro += (-estado.vento * 0.12 - cam.giro) * suave(dt, 2);
  }

  // ---------------- o desenho (pinta em qualquer tela: a da página ou a de 4K) ----------------
  function projetor(tela) {
    const s = cam.z * (tela.H / (2 * MEIA_A));
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const pitch = 0.1 * cam.pz, cp = Math.cos(pitch), spi = Math.sin(pitch);
    const cr = Math.cos(cam.giro), sr = Math.sin(cam.giro);
    // a câmera recua junto com o zoom: sem isso a assinatura (dezenas de unidades) entortava
    const dist = DIST / cam.z;
    return (x, y, z, out) => {
      const rx = x - cam.x, ry = y - cam.y, rz = (z - cam.zc) * cam.pz;
      const x1 = rx * cy - rz * sy, z1 = rx * sy + rz * cy;
      const y1 = ry * cp - z1 * spi, z2 = ry * spi + z1 * cp;
      const k = dist / Math.max(dist * 0.07, dist + z2);
      const px = x1 * k, py = y1 * k;
      out.x = tela.W / 2 + (px * cr - py * sr) * s;
      out.y = tela.H / 2 - (px * sr + py * cr) * s;
      out.k = k;
      return out;
    };
  }

  function cadeiaPontos(no, ponta) {
    const pts = [ponta.x, ponta.y, ponta.z];
    const segmento = (de, ate, j) => {
      for (let q = 1; q <= 4; q++) {
        const u = q / 4, dx = j * Math.sin(u * Math.PI);
        pts.push(de.x + (ate.x - de.x) * u + dx, de.y + (ate.y - de.y) * u + dx * 0.3, de.z + (ate.z - de.z) * u);
      }
    };
    if (no.pai) segmento(ponta, no.pai, no.j);
    for (let a = no.pai; a && a.pai; a = a.pai) segmento(a, a.pai, a.j);
    return pts;
  }

  // `toques: false` deixa o brilho do clique fora (a assinatura em PNG sai limpa)
  function pintar(tela, assinatura, { toques: comToques = true } = {}) {
    const { g, W, H } = tela;
    const esc = Math.min(W, H) / 540;
    const P = projetor(tela);
    const a = { x: 0, y: 0, k: 1 }, b = { x: 0, y: 0, k: 1 };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = "#0b0b0d";
    g.fillRect(0, 0, W, H);
    g.lineCap = "round";
    g.lineJoin = "round";
    const recua = assinatura ? 0.3 : 1;

    // a busca já crescida, em baldes de idade (5) × distância (3): longe e antigo apagam
    const baldes = Array.from({ length: 15 }, () => new Path2D());
    for (const e of estado.arestas) {
      P(e.x0, e.y0, e.z0, a); P(e.x1, e.y1, e.z1, b);
      const idade = Math.min(4, Math.floor(((estado.nivel - e.d) / MEMORIA_NIVEIS) * 5));
      const km = (a.k + b.k) / 2;
      const perto = km > 1.06 ? 0 : km > 0.94 ? 1 : 2;
      const p = baldes[idade * 3 + perto];
      p.moveTo(a.x, a.y);
      p.lineTo(b.x, b.y);
    }
    baldes.forEach((p, i) => {
      const idade = Math.floor(i / 3), perto = i % 3;
      g.strokeStyle = `rgba(110, 106, 99, ${0.6 * (1 - idade / 5) * [1, 0.78, 0.52][perto] * recua})`;
      g.lineWidth = 1.1 * esc * [1.2, 1, 0.8][perto];
      g.stroke(p);
    });

    // o nível nascendo agora, e os tocos dele
    const f = estado.frac, ft = Math.min(1, f * 2.8) * 0.35;
    const nasc = new Path2D();
    for (const n of estado.crescendo) {
      P(n.pai.x, n.pai.y, n.pai.z, a); P(n.pai.x + (n.x - n.pai.x) * f, n.pai.y + (n.y - n.pai.y) * f, n.pai.z + (n.z - n.pai.z) * f, b);
      nasc.moveTo(a.x, a.y); nasc.lineTo(b.x, b.y);
    }
    for (const n of estado.tocos) {
      P(n.pai.x, n.pai.y, n.pai.z, a); P(n.pai.x + (n.x - n.pai.x) * ft, n.pai.y + (n.y - n.pai.y) * ft, n.pai.z + (n.z - n.pai.z) * ft, b);
      nasc.moveTo(a.x, a.y); nasc.lineTo(b.x, b.y);
    }
    g.strokeStyle = `rgba(110, 106, 99, ${0.65 * recua})`;
    g.lineWidth = 1.1 * esc;
    g.stroke(nasc);
    g.fillStyle = `rgba(236, 230, 218, ${0.75 * recua})`;
    for (const n of estado.crescendo) {
      P(n.pai.x + (n.x - n.pai.x) * f, n.pai.y + (n.y - n.pai.y) * f, n.pai.z + (n.z - n.pai.z) * f, a);
      const t = 2.2 * esc * a.k;
      g.fillRect(a.x - t / 2, a.y - t / 2, t, t);
    }

    // o caminho que a música escolheu: o trajeto do principal; troca de galho vira ponte pontilhada
    const linhaCaminho = new Path2D(), pontes = new Path2D();
    let fimAnterior = null;
    for (const seg of caminho.segmentos) {
      if (seg.length < 3) continue;
      P(seg[0], seg[1], seg[2], a);
      if (fimAnterior) { pontes.moveTo(fimAnterior.x, fimAnterior.y); pontes.lineTo(a.x, a.y); }
      linhaCaminho.moveTo(a.x, a.y);
      for (let i = 3; i < seg.length; i += 3) { P(seg[i], seg[i + 1], seg[i + 2], a); linhaCaminho.lineTo(a.x, a.y); }
      fimAnterior = { x: a.x, y: a.y };
    }
    if (assinatura) {
      g.strokeStyle = "rgba(224, 88, 58, 0.16)";
      g.lineWidth = 7 * esc;
      g.stroke(linhaCaminho);
    }
    g.strokeStyle = `rgba(236, 230, 218, ${assinatura ? 0.95 : 0.42})`;
    g.lineWidth = (assinatura ? 2.2 : 1.3) * esc;
    g.stroke(linhaCaminho);
    // ao vivo a ponte cruza a copa e parece galho solto: ela só conta a história na assinatura
    if (assinatura) {
      g.setLineDash([3 * esc, 5 * esc]);
      g.strokeStyle = "rgba(110, 106, 99, 0.55)";
      g.lineWidth = 1 * esc;
      g.stroke(pontes);
      g.setLineDash([]);
    }

    if (comToques) pintarToques(g, P, esc, a, b);

    // os raios: cada um pelo brilho (luz) e pela voz do papel que ocupa
    const raio = (no, pt, luz, voz) => {
      const pts = cadeiaPontos(no, pt);
      const linha = new Path2D();
      let k = 1;
      for (let i = 0; i < pts.length; i += 3) {
        P(pts[i], pts[i + 1], pts[i + 2], a);
        if (i === 0) { linha.moveTo(a.x, a.y); k = a.k; } else linha.lineTo(a.x, a.y);
      }
      const p = voz ? voz.pulso : 0, nv = voz ? voz.nivel : 0;
      const brasa = Math.max(0, (luz - 0.45) / 0.55) ** 1.5;
      if (brasa > 0.01) {
        g.strokeStyle = `rgba(224, 88, 58, ${(0.05 + 0.12 * p) * brasa})`; g.lineWidth = 14 * esc; g.stroke(linha);
        g.strokeStyle = `rgba(224, 88, 58, ${(0.15 + 0.3 * p) * brasa})`; g.lineWidth = 6 * esc; g.stroke(linha);
      }
      g.strokeStyle = `rgba(236, 230, 218, ${0.95 * luz})`;
      g.lineWidth = (0.9 + 0.9 * luz + (0.6 + 1.0 * luz) * nv) * esc;
      g.stroke(linha);
      P(pt.x, pt.y, pt.z, a);
      g.beginPath();
      g.arc(a.x, a.y, (2.4 + 1.6 * luz + (1.5 + 2.5 * luz) * p) * esc * k, 0, 2 * Math.PI);
      g.fillStyle = `rgba(236, 230, 218, ${0.45 + 0.55 * luz})`;
      g.fill();
    };
    for (const fa of estado.fantasmas) raio(fa, fa, fa.luz, null);
    for (let i = 2; i >= 0; i--) if (estado.raios[i]) raio(estado.raios[i], estado.pontas[i], estado.raios[i].luz, vozes[i]);

    if (assinatura) assinar(tela);
  }

  // a ficha da assinatura, no canto, e a marca de quem pediu (`marca`: [parte forte, parte leve], a casa passa
  // a dela). Sem marca, o canto fica vazio: é o que o repo aberto usa
  function assinar({ g, W, H }) {
    const esc = Math.min(W, H) / 540;
    const margem = 26 * esc;
    const min = Math.floor(caminho.tocado / 60), seg = Math.round(caminho.tocado % 60);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.textBaseline = "alphabetic";
    // linha de cima: a faixa à esquerda, a marca à direita; embaixo, os números
    const base = H - 44 * esc;
    let largMarca = 0;
    if (config.marca) {
      const [forte, leve] = config.marca;
      g.textAlign = "right";
      g.font = `400 ${14 * esc}px system-ui, "Segoe UI", sans-serif`;
      g.fillStyle = "#6e6a63";
      g.fillText(leve, W - margem, base);
      const largLeve = g.measureText(leve).width;
      g.font = `600 ${14 * esc}px system-ui, "Segoe UI", sans-serif`;
      g.fillStyle = "#ece6da";
      g.fillText(forte, W - margem - largLeve, base);
      largMarca = largLeve + g.measureText(forte).width;
    }
    g.textAlign = "left";
    g.font = `600 ${15 * esc}px Consolas, ui-monospace, monospace`;
    g.fillStyle = "#ece6da";
    const en = config.idioma === "en";
    g.fillText(caminho.faixa || (en ? "untitled" : "sem título"), margem, base, W - 2 * margem - largMarca - 16 * esc);
    g.font = `${11 * esc}px Consolas, ui-monospace, monospace`;
    g.fillStyle = "#6e6a63";
    const tempo = `${min}:${String(seg).padStart(2, "0")}`, trocas = caminho.segmentos.length - 1;
    g.fillText(en ? `${tempo} of music  ·  ${estado.nivel} levels of search  ·  ${trocas} branch switches` : `${tempo} de música  ·  ${estado.nivel} níveis  ·  ${trocas} trocas de galho`, margem, H - 24 * esc, W - 2 * margem);
  }

  function novoCaminho(faixa = "") {
    caminho.segmentos = [];
    caminho.faixa = faixa;
    caminho.tocado = 0;
    estado.principalTrocou = true;
  }

  function mudarVista(modo) {
    vista.modo = modo ?? (vista.modo === "assinatura" ? "vivo" : "assinatura");
    return vista.modo;
  }

  return {
    config, tela, estado, cam, forma, vozes, caminho, vista, VOZES,
    passo, pintar, tocar, novoCaminho, mudarVista, nomeForma, caixaDoCaminho, enquadrarAssinatura,
    medir(W, H) { tela.W = W; tela.H = H; },
  };
}

// gerador com semente (mulberry32), pro render sair igual toda vez
export function sementeira(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
