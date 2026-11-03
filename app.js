// Melodytree: drop a song and a search tree grows with it.
// Everything runs in the browser. The song never leaves the device: no upload,
// no server, no account. The engine (lib/arvore-motor.js) and the listener
// (lib/escuta.js) are the same ones that render the tree's videos.
import { criarSom } from "./lib/escuta.js";
import { criarArvore } from "./lib/arvore-motor.js";

const TEXTOS = {
  en: {
    titulo: "Every song draws its own lightning.",
    sub: "Drop a song and a search tree grows with it. The bass, the mids and the highs light three branches, and when the track ends, the lit path becomes its signature.",
    soltar: "Drop a song here", soltarDica: "or click to choose a file. It stays on your device.",
    ou: "or listen through the", microfone: "microphone", ouvir: "Or just listen",
    cancaoT: "One song, start to finish",
    comecoT: "At the start", comecoP: "The tree rises from the ground and goes looking for a way. Three bolts travel on separate branches, each one listening to a voice of the music.",
    refraoT: "In the chorus", refraoP: "The camera reads the shape: it opens on the chorus, closes on the verse, holds on the break. When the sound stops, the tree stops where it is.",
    fimT: "At the end", fimP: "The main bolt's path becomes the track's signature, a 4K PNG, portrait or landscape. You can record the video too.",
    creditosT: "Credits",
    ondeT: "Where it runs", ondeP: "In your browser. Nothing to install.",
    musicaT: "Your music", musicaP: "Stays on your device. Nothing uploads, no account.",
    fezT: "Made by", codigoT: "Code",
    profundidade: "depth", tocar: "play", pausar: "pause", ouvindo: "listening",
    ver: "path", vivo: "live", salvar: "save", salvarDica: "save the signature as a 4K PNG", gravar: "record", parar: "stop", trocar: "another song", cheia: "fullscreen",
    semMic: "the browser did not give the microphone", semGravar: "this browser cannot record the canvas",
    ouvirCartao: "Listen", soltarSua: "Or drop your own song", dica: "tap the tree",
    inteira: "full version ↗", inteiraDica: "save the signature and record the video on the full page",
  },
  pt: {
    titulo: "Cada música desenha o próprio raio.",
    sub: "Solta uma música e uma árvore de busca cresce com ela. O grave, o médio e o agudo acendem três galhos, e quando a faixa acaba o caminho aceso vira a assinatura dela.",
    soltar: "Solta a música aqui", soltarDica: "ou clica pra escolher. Ela não sai do seu aparelho.",
    ou: "ou ouve pelo", microfone: "microfone", ouvir: "Ou só ouvir",
    cancaoT: "Uma música, do começo ao fim",
    comecoT: "No começo", comecoP: "A árvore nasce do chão e sai procurando caminho. Três raios andam em galhos separados, cada um ouvindo uma voz da música.",
    refraoT: "No refrão", refraoP: "A câmera lê a forma: abre no refrão, fecha no verso, segura na quebra. Se o som para, a árvore para onde está.",
    fimT: "No fim", fimP: "O caminho do raio principal vira a assinatura da faixa, em PNG 4K, em pé ou deitado. Dá pra gravar o vídeo também.",
    creditosT: "Créditos",
    ondeT: "Onde roda", ondeP: "No seu navegador. Nada pra instalar.",
    musicaT: "A sua música", musicaP: "Fica no seu aparelho. Nada sobe, não pede conta.",
    fezT: "Feito por", codigoT: "Código",
    profundidade: "profundidade", tocar: "tocar", pausar: "pausar", ouvindo: "ouvindo",
    ver: "caminho", vivo: "ao vivo", salvar: "salvar", salvarDica: "salva a assinatura em PNG 4K", gravar: "gravar", parar: "parar", trocar: "outra música", cheia: "tela cheia",
    semMic: "o navegador não liberou o microfone", semGravar: "este navegador não grava o canvas",
    ouvirCartao: "Ouvir", soltarSua: "Ou solta a sua", dica: "toca na árvore",
    inteira: "versão completa ↗", inteiraDica: "salva a assinatura e grava o vídeo na página inteira",
  },
};
const params = new URLSearchParams(location.search);
// ?lang= manda; sem ele, o idioma do navegador (português vira pt, o resto en)
const lang = params.get("lang") || ((navigator.language || "").toLowerCase().startsWith("pt") ? "pt" : "en");
const T = TEXTOS[lang] || TEXTOS.en;
document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
for (const el of document.querySelectorAll("[data-t]")) el.textContent = T[el.dataset.t];
for (const el of document.querySelectorAll("[data-dica]")) el.title = el.ariaLabel = T[el.dataset.dica];
for (const a of document.querySelectorAll(".lingua a")) {
  a.classList.toggle("aqui", a.dataset.l === lang);
  // troca o idioma sem perder o resto do endereço (o ?de=x do cartão)
  const p = new URLSearchParams(location.search);
  p.set("lang", a.dataset.l);
  a.href = `?${p}`;
}

const $ = (q) => document.querySelector(q);
// O cartão (o script do <head> decide: dentro de iframe ou ?de=x). Link pra fora abre aba nova, porque quem
// emoldura nem sempre deixa navegar dentro, e a versão completa é a mesma página sem o ?de=x.
const cartao = document.documentElement.classList.contains("cartao");
if (cartao) {
  $("#discos .rotulo").textContent = T.ouvirCartao;
  $("#soltar strong").textContent = T.soltarSua;
  for (const a of document.querySelectorAll("a[href^='http']")) a.target = "_blank";
}
const inteira = new URL(location.href);
inteira.searchParams.delete("de");
inteira.searchParams.set("lang", lang);
$("#inteira").href = inteira.href;
// iPhone e iframe sem allowfullscreen não dão tela cheia: o botão sai em vez de falhar calado
if (!document.fullscreenEnabled) $("#cheia").hidden = true;
const canvas = $("#tela"), g = canvas.getContext("2d", { alpha: false });
const audio = $("#audio");
const SILENCIO = { nivel: 0, pulso: 0, batidas: 0, altura: 220, bandas: new Float32Array(8), ataques: new Float32Array(8), rms: 0, presenca: 0, bpm: 120 };
const arvore = criarArvore({
  idioma: lang === "pt" ? "pt" : "en",
});
let som = null, microfone = null, elemento = null, nome = "";

// ---------- tela ----------
let W = 0, H = 0;
function dimensionar() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.width = Math.round(innerWidth * dpr);
  H = canvas.height = Math.round(innerHeight * dpr);
  arvore.medir(W, H);
}
addEventListener("resize", dimensionar);
dimensionar();

// ---------- som ----------
function garantirSom() {
  if (!som) { som = criarSom(audio); elemento = som.fonte; }
  return som;
}
async function abrir(arquivo) {
  await tocarUrl(URL.createObjectURL(arquivo), arquivo.name.replace(/\.[^.]+$/, ""));
}
async function tocarUrl(url, titulo) {
  garantirSom();
  if (som.fonte !== elemento) som.ligarFonte(elemento, { audivel: true });
  nome = titulo;
  audio.src = url;
  arvore.novoCaminho(nome);
  arvore.mudarVista("vivo");
  await som.ctx.resume();
  await audio.play();
  entrar();
}
async function ouvirMicrofone() {
  try {
    garantirSom();
    if (!microfone) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      microfone = som.ctx.createMediaStreamSource(stream);
    }
    audio.pause();
    som.ligarFonte(microfone, { audivel: false, aoVivo: true });
    await som.ctx.resume();
    nome = T.microfone;
    arvore.novoCaminho(nome);
    arvore.mudarVista("vivo");
    entrar();
  } catch { alert(T.semMic); }
}
const tocando = () => Boolean(som && (som.aoVivo || !audio.paused));

// ---------- faixas de exemplo, sorteadas a cada visita (só se musicas/lista.json existir) ----------
// Faixa de outro domínio precisa mandar CORS: o <audio> pede com crossorigin, senão o analisador ouve silêncio.
const embaralhar = (lista) => {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
};
fetch("musicas/lista.json").then((r) => (r.ok ? r.json() : null)).then((lista) => {
  const todas = embaralhar([...(lista?.faixas || [])]);
  if (!todas.length) return;
  // um título em português, um em inglês e um em francês entram primeiro; o resto completa, e a ordem se embaralha
  // de novo pra a língua não cair sempre na mesma linha
  const quantas = cartao ? 3 : 5;
  const escolhidas = [];
  for (const l of ["pt", "en", "fr"]) {
    const f = todas.find((x) => x.lingua === l);
    if (f) escolhidas.push(f);
  }
  for (const f of todas) if (escolhidas.length < quantas && !escolhidas.includes(f)) escolhidas.push(f);
  const faixas = $("#faixas");
  for (const faixa of embaralhar(escolhidas.slice(0, quantas))) {
    const b = document.createElement("button");
    b.textContent = faixa.titulo;
    b.onclick = () => {
      for (const x of faixas.querySelectorAll(".tocando")) x.classList.remove("tocando");
      b.classList.add("tocando");
      tocarUrl(faixa.arquivo, faixa.titulo);
    };
    const li = document.createElement("li");
    li.appendChild(b);
    faixas.appendChild(li);
  }
  $("#discos").hidden = false;
}).catch(() => {});

// ---------- a porta (o primeiro contato) ----------
// O vídeo do topo é a árvore crescendo com uma música: toca enquanto a porta está
// aberta, para quando a árvore de verdade entra, e fica no quadro parado pra quem pede menos movimento.
const capa = $("#capa");
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;
const capaToca = (sim) => { if (quieto || !sim) capa.pause(); else capa.play().catch(() => {}); };
capaToca(true);
const soltar = $("#soltar");
$("#arquivo").onchange = (e) => e.target.files[0] && abrir(e.target.files[0]);
$("#mic").onclick = ouvirMicrofone;
for (const ev of ["dragenter", "dragover"]) addEventListener(ev, (e) => { e.preventDefault(); soltar.classList.add("cima"); });
addEventListener("dragleave", () => soltar.classList.remove("cima"));
addEventListener("drop", (e) => {
  e.preventDefault();
  soltar.classList.remove("cima");
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(x.name));
  if (f) abrir(f);
});
function entrar() {
  $("#porta").classList.add("some");
  capaToca(false);
  $("#barra").hidden = false;
  $("#faixa").textContent = nome;
  atualizarBotoes();
  acordarBarra();
}

// ---------- a barra (some quando ninguém mexe: a tela é da árvore) ----------
let sono = null;
function acordarBarra() {
  $("#barra").classList.remove("quieta");
  clearTimeout(sono);
  sono = setTimeout(() => $("#barra").classList.add("quieta"), 2600);
}
for (const ev of ["mousemove", "touchstart", "keydown"]) addEventListener(ev, acordarBarra, { passive: true });

const ICONE = {
  tocar: '<svg viewBox="0 0 16 16"><path d="M4.5 2.5v11l9-5.5z"/></svg>',
  pausar: '<svg viewBox="0 0 16 16"><path d="M4 2.5h2.8v11H4zM9.2 2.5H12v11H9.2z"/></svg>',
  ouvindo: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.5"/></svg>',
};
function atualizarBotoes() {
  const estado = som?.aoVivo ? "ouvindo" : audio.paused ? "tocar" : "pausar";
  $("#tocar").innerHTML = ICONE[estado];
  $("#tocar").title = $("#tocar").ariaLabel = T[estado];
  $("#ver").textContent = arvore.vista.modo === "assinatura" ? T.vivo : T.ver;
  $("#gravar").textContent = gravacao ? T.parar : T.gravar;
  $("#gravar").classList.toggle("gravando", Boolean(gravacao));
}
async function alternarTocar() {
  if (!som || som.aoVivo) return;
  await som.ctx.resume();
  if (audio.paused) await audio.play(); else audio.pause();
  atualizarBotoes();
}
$("#tocar").onclick = alternarTocar;
$("#fundo").onclick = (e) => { arvore.config.profundidade = !arvore.config.profundidade; e.currentTarget.classList.toggle("aceso", arvore.config.profundidade); };
$("#ver").onclick = () => { arvore.mudarVista(); atualizarBotoes(); };
$("#trocar").onclick = () => { $("#porta").classList.remove("some"); capaToca(true); audio.pause(); atualizarBotoes(); };
$("#cheia").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
audio.addEventListener("ended", () => { arvore.mudarVista("assinatura"); atualizarBotoes(); if (gravacao) setTimeout(pararGravacao, 6000); });
audio.addEventListener("play", () => { if (audio.currentTime < 0.3) arvore.novoCaminho(nome); arvore.mudarVista("vivo"); atualizarBotoes(); });
audio.addEventListener("pause", atualizarBotoes);
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (k === " ") { e.preventDefault(); alternarTocar(); }
  else if (k === "f") $("#cheia").click();
  else if (k === "v") $("#ver").click();
});

// ---------- guardar: a assinatura em PNG e a gravação em vídeo, direto no aparelho ----------
const baixar = (blob, arquivo) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = arquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$("#salvar").onclick = () => {
  const c = arvore.caixaDoCaminho();
  const emPe = c && (c.y1 - c.y0) > 1.2 * Math.max(c.x1 - c.x0, 1);
  const [gw, gh] = emPe ? [2160, 3840] : [3840, 2160];
  const grande = document.createElement("canvas");
  grande.width = gw; grande.height = gh;
  const salvo = { ...arvore.cam };
  Object.assign(arvore.cam, arvore.enquadrarAssinatura(gw, gh) || {}, { giro: 0, yaw: 0, pz: 0 });
  arvore.pintar({ g: grande.getContext("2d"), W: gw, H: gh }, true, { toques: false });
  Object.assign(arvore.cam, salvo);
  grande.toBlob((b) => baixar(b, `${nome || "melodytree"} - signature.png`), "image/png");
};

let gravacao = null;
function pararGravacao() { if (gravacao && gravacao.state !== "inactive") gravacao.stop(); }
$("#gravar").onclick = () => {
  if (gravacao) return pararGravacao();
  if (!som || !window.MediaRecorder) return alert(T.semGravar);
  const stream = canvas.captureStream(60);
  const destino = som.ctx.createMediaStreamDestination();
  som.fonte.connect(destino);
  // as notas dos toques entram no vídeo junto com a música
  const notas = saidaDosToques();
  notas.connect(destino);
  for (const t of destino.stream.getAudioTracks()) stream.addTrack(t);
  const mime = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const pedacos = [];
  gravacao = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16e6 });
  gravacao.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
  gravacao.onstop = () => {
    try { som.fonte.disconnect(destino); } catch {}
    try { notas.disconnect(destino); } catch {}
    for (const t of stream.getTracks()) t.stop();
    gravacao = null;
    atualizarBotoes();
    baixar(new Blob(pedacos, { type: mime || "video/webm" }), `${nome || "melodytree"}.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`);
  };
  gravacao.start(1000);
  atualizarBotoes();
};

// ---------- o toque: clicar (ou arrastar) na árvore toca uma nota no tom da música e acende os galhos em volta ----------
// O tom sai do cromagrama dos últimos segundos (perfis de Krumhansl) e a nota é da pentatônica dele, que não briga
// com a faixa. Mais alto na tela, mais aguda; o lado do toque vira o lado do estéreo; entre as vizinhas, ganha a nota
// que a música está tocando mais agora, e a mesma de antes perde a vez. Sem música ouvida ainda, lá menor.
const croma = new Float32Array(12);
let classeDoBin = null;
function ouvirTom(dt) {
  if (!som?.espectro || !tocando()) return;
  const e = som.espectro;
  if (!classeDoBin) {
    const hz = som.ctx.sampleRate / som.analisador.fftSize;
    classeDoBin = Int8Array.from(e, (_, i) => (i * hz < 200 || i * hz > 4000 ? -1 : (Math.round(69 + 12 * Math.log2((i * hz) / 440)) % 12 + 12) % 12));
  }
  const agora = new Float32Array(12);
  for (let i = 0; i < e.length; i++) if (classeDoBin[i] >= 0) agora[classeDoBin[i]] += (e[i] / 255) ** 2;
  const k = Math.min(1, dt / 6);
  for (let p = 0; p < 12; p++) croma[p] += (agora[p] - croma[p]) * k;
}
const MAIOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MENOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function correlacao(xs, ys) {
  const mx = xs.reduce((s, v) => s + v, 0) / 12, my = ys.reduce((s, v) => s + v, 0) / 12;
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < 12; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return n / (Math.sqrt(dx * dy) || 1);
}
function tom() {
  let melhor = { tonica: 9, menor: true, r: -Infinity };
  if (!croma.some((v) => v > 0)) return melhor;
  for (let t = 0; t < 12; t++) {
    const girado = Array.from({ length: 12 }, (_, p) => croma[(t + p) % 12]);
    for (const [perfil, menor] of [[MAIOR, false], [MENOR, true]]) {
      const r = correlacao(girado, perfil);
      if (r > melhor.r) melhor = { tonica: t, menor, r };
    }
  }
  return melhor;
}
let ultimaNota = -1;
function escolherNota(altura) {
  const { tonica, menor } = tom();
  const escala = menor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  // a tônica entre mi 3 e ré# 4, e dez graus acima dela: o toque mais alto fica abaixo de ~dó# 6 (1,1 kHz), sem estridência
  const base = 52 + ((tonica - 4 + 12) % 12);
  const graus = Array.from({ length: 10 }, (_, i) => base + 12 * Math.floor(i / 5) + escala[i % 5]);
  const alvo = Math.round(Math.max(0, Math.min(1, altura)) * 9);
  const forte = Math.max(...croma) || 1;
  const opcoes = [alvo - 1, alvo, alvo + 1].filter((i) => i >= 0 && i <= 9).map((i) => graus[i]).filter((n) => n !== ultimaNota);
  const pesos = opcoes.map((n) => 0.25 + croma[n % 12] / forte + (n === graus[alvo] ? 0.6 : 0));
  let sorte = Math.random() * pesos.reduce((s, v) => s + v, 0);
  ultimaNota = opcoes.find((_, i) => (sorte -= pesos[i]) <= 0) ?? opcoes[0];
  return ultimaNota;
}
// a saída das notas: um pouco de sala (reverb de ruído que decai) e um compressor pra muitas notas juntas não estourarem
let notasSaida = null, notasEntrada = null;
function saidaDosToques() {
  if (notasSaida) return notasSaida;
  const ctx = som.ctx;
  notasSaida = ctx.createDynamicsCompressor();
  notasSaida.connect(ctx.destination);
  const sala = ctx.createConvolver();
  const n = Math.round(ctx.sampleRate * 2.4);
  sala.buffer = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = sala.buffer.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3; }
  const molhado = ctx.createGain();
  molhado.gain.value = 0.3;
  sala.connect(molhado).connect(notasSaida);
  notasEntrada = ctx.createGain();
  notasEntrada.gain.value = 0.22;
  notasEntrada.connect(notasSaida);
  notasEntrada.connect(sala);
  return notasSaida;
}
// timbre de baqueta macia: seno com um parcial de oitava que morre cedo e um triângulo baixinho; cada nota varia
// um fio na afinação, no tempo de queda e no brilho
function soar(midi, pan, forca) {
  saidaDosToques();
  const ctx = som.ctx, t = ctx.currentTime;
  const f = 440 * 2 ** ((midi - 69) / 12 + (Math.random() - 0.5) * 0.006);
  const dur = 1.3 + Math.random() * 0.9;
  const lado = ctx.createStereoPanner();
  lado.pan.value = pan;
  lado.connect(notasEntrada);
  const filtro = ctx.createBiquadFilter();
  filtro.type = "lowpass";
  filtro.frequency.value = 1800 + 1400 * forca;
  filtro.connect(lado);
  for (const [mult, tipo, ganho, queda] of [[1, "sine", 0.6, dur], [2.003, "sine", 0.14, dur * 0.35], [1, "triangle", 0.08, dur * 0.6]]) {
    const o = ctx.createOscillator();
    o.type = tipo;
    o.frequency.value = f * mult;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(ganho * forca, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + queda);
    o.connect(env).connect(filtro);
    o.start(t);
    o.stop(t + queda + 0.05);
  }
}
let arrasto = null;
function tocarEm(cx, cy, forca) {
  if (!som) return;
  som.ctx.resume();
  const dpr = W / innerWidth;
  arvore.tocar(cx * dpr, cy * dpr, { W, H }, forca);
  soar(escolherNota(1 - cy / innerHeight), (cx / innerWidth * 2 - 1) * 0.6, forca);
  $("#dica").hidden = true;
}
canvas.addEventListener("pointerdown", (e) => {
  arrasto = { x: e.clientX, y: e.clientY, t: performance.now() };
  tocarEm(e.clientX, e.clientY, 1);
});
// arrastar dedilha: uma nota a cada ~48 px andados, no máximo umas 12 por segundo
canvas.addEventListener("pointermove", (e) => {
  if (!arrasto || !e.buttons) return;
  const agora = performance.now();
  if (Math.hypot(e.clientX - arrasto.x, e.clientY - arrasto.y) < 48 || agora - arrasto.t < 80) return;
  arrasto = { x: e.clientX, y: e.clientY, t: agora };
  tocarEm(e.clientX, e.clientY, 0.7);
});
addEventListener("pointerup", () => { arrasto = null; });

// ---------- o laço: a música é o motor (sem som, a árvore para onde está) ----------
let antes = performance.now();
(function quadro() {
  const agora = performance.now();
  const dt = Math.min(0.05, (agora - antes) / 1000);
  antes = agora;
  ouvirTom(dt);
  arvore.passo(dt, som ? som.S : SILENCIO, tocando());
  arvore.pintar({ g, W, H }, arvore.vista.modo === "assinatura");
  requestAnimationFrame(quadro);
})();
