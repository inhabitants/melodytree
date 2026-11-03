// A escuta da casa: transforma o áudio que toca em S, o estado sonoro que as cenas
// ao vivo leem a cada quadro. Sem dependência nenhuma: serve a bancada e o site público.
//
// S (o estado sonoro, 0..1, atualizado a cada quadro):
//   grave, medio, agudo  bandas com teto adaptativo (o pico decai devagar)
//   nivel                RMS do quadro, no mesmo teto adaptativo
//   pulso                1 na batida (fluxo espectral acima da média), decai em ~250 ms
//   batidas              contador de batidas (pra trocar de forma em compasso)
//   altura               Hz do pico mais forte entre 80 e 1600 Hz, suavizado em escala log
//   bandas               8 bandas em escala log (40 Hz a 10 kHz), cada uma com o próprio teto
//   ataques              8 bandas de ATAQUE (fluxo espectral da banda contra a média dela no último
//                        segundo): 1 no bumbo, no chimbal, na sílaba. As `bandas` dizem quanto tem; os
//                        ataques dizem quando entrou, que é o que a banda saturada perde
//   rms                  RMS cru do quadro (sem teto adaptativo): é onde refrão e verso diferem
//   presenca             0 no silêncio, 1 com música: é o motor das cenas ao vivo (sem som, a cena repousa)
//   bpm                  andamento estimado pela mediana dos últimos intervalos entre batidas
//   t                    segundos de música tocada

// A escuta em si, sem Web Audio: recebe o espectro e a onda em bytes (o formato do
// AnalyserNode) e o relógio, e atualiza S. O vivo (criarSom) e o render offline
// (escuta-offline.js, que calcula os mesmos bytes a partir do PCM) passam por aqui,
// então o vídeo renderizado ouve a música exatamente como a página ao vivo.
export function criarEscuta({ sampleRate, fftSize = 2048 }) {
  const nBins = fftSize / 2;
  const anterior = new Float32Array(nBins);
  const hzPorBin = sampleRate / fftSize;
  const faixa = (de, ate) => [Math.max(1, Math.round(de / hzPorBin)), Math.round(ate / hzPorBin)];
  const BANDAS = { grave: faixa(25, 160), medio: faixa(160, 2000), agudo: faixa(2000, 9000) };
  const BANDAS8 = Array.from({ length: 8 }, (_, i) => faixa(40 * 250 ** (i / 8), 40 * 250 ** ((i + 1) / 8)));
  const tetos8 = new Float32Array(8).fill(0.2);
  const binBanda = new Int8Array(nBins).fill(-1);
  BANDAS8.forEach(([de, ate], b) => { for (let i = de; i <= Math.max(de, ate); i++) binBanda[i] = b; });
  const binsPorBanda = BANDAS8.map(([de, ate]) => Math.max(de, ate) - de + 1);
  const fluxo8 = new Float32Array(8), mediaFluxo8 = new Float32Array(8).fill(0.01);
  const intervalos = [];

  const tetos = { grave: 0.2, medio: 0.2, agudo: 0.2, nivel: 0.05 };
  const S = { grave: 0, medio: 0, agudo: 0, nivel: 0, pulso: 0, batidas: 0, altura: 220, bandas: new Float32Array(8), ataques: new Float32Array(8), rms: 0, presenca: 0, bpm: 120, t: 0 };
  const [picoDe, picoAte] = faixa(80, 1600);
  let log2Altura = Math.log2(220);
  let fluxoMedio = 0;
  let ultimaBatida = 0;
  let ultimoQuadro = null;

  function normalizar(nome, valor, dt) {
    tetos[nome] = Math.max(valor, tetos[nome] * Math.exp(-dt / 6));
    return Math.min(1, valor / (tetos[nome] + 1e-6));
  }

  // agora em ms (performance.now() ao vivo, tempo da faixa no render); t em segundos de música
  function processar(espectro, onda, agora, tocando, t) {
    const dt = ultimoQuadro === null ? 1 / 60 : Math.min(0.1, (agora - ultimoQuadro) / 1000);
    ultimoQuadro = agora;

    for (const [nome, [de, ate]] of Object.entries(BANDAS)) {
      let soma = 0;
      for (let i = de; i <= ate; i++) soma += espectro[i] / 255;
      const bruto = soma / (ate - de + 1);
      const alvo = normalizar(nome, bruto, dt);
      // ataque rápido, soltura lenta: o visual sobe com a nota e desce sem tremer
      const k = alvo > S[nome] ? 0.5 : 0.08;
      S[nome] += (alvo - S[nome]) * k;
    }

    let rms = 0;
    for (let i = 0; i < onda.length; i++) {
      const v = (onda[i] - 128) / 128;
      rms += v * v;
    }
    const rmsBruto = Math.sqrt(rms / onda.length);
    S.rms = rmsBruto;
    S.nivel = normalizar("nivel", rmsBruto, dt);

    for (let b = 0; b < 8; b++) {
      const [de, ate] = BANDAS8[b];
      let soma = 0;
      for (let i = de; i <= Math.max(de, ate); i++) soma += espectro[i] / 255;
      const bruto = soma / (Math.max(de, ate) - de + 1);
      tetos8[b] = Math.max(bruto, tetos8[b] * Math.exp(-dt / 6));
      const alvo = Math.min(1, bruto / (tetos8[b] + 1e-6));
      S.bandas[b] += (alvo - S.bandas[b]) * (alvo > S.bandas[b] ? 0.5 : 0.1);
    }

    let pico = picoDe;
    for (let i = picoDe; i <= picoAte; i++) if (espectro[i] > espectro[pico]) pico = i;
    if (S.nivel > 0.15 && espectro[pico] > 60) {
      log2Altura += (Math.log2(pico * hzPorBin) - log2Altura) * 0.12;
      S.altura = 2 ** log2Altura;
    }

    let fluxo = 0;
    fluxo8.fill(0);
    for (let i = 0; i < espectro.length; i++) {
      const v = espectro[i] / 255;
      const sobe = Math.max(0, v - anterior[i]);
      fluxo += sobe;
      if (binBanda[i] >= 0) fluxo8[binBanda[i]] += sobe;
      anterior[i] = v;
    }
    fluxoMedio += (fluxo - fluxoMedio) * 0.05;
    for (let b = 0; b < 8; b++) {
      const f = fluxo8[b] / binsPorBanda[b];
      const razao = f / (mediaFluxo8[b] + 1e-4);
      mediaFluxo8[b] += (f - mediaFluxo8[b]) * Math.min(1, dt / 1.0);
      // 30% acima da média da banda começa a contar; 3× a média é ataque cheio
      S.ataques[b] = tocando ? Math.max(0, Math.min(1, (razao - 1.3) / 1.7)) : 0;
    }
    // presença pelo RMS cru (−48 dBFS), não pelo normalizado: o teto adaptativo faz um sussurro valer 1
    const alvoPresenca = tocando && rmsBruto > 0.004 ? 1 : 0;
    // sobe em 0,25 s, solta em 0,6 s e zera abaixo de 3%: a cena desliza um instante e para de vez
    S.presenca += (alvoPresenca - S.presenca) * Math.min(1, dt / (alvoPresenca > S.presenca ? 0.25 : 0.6));
    if (!alvoPresenca && S.presenca < 0.03) S.presenca = 0;
    if (tocando && fluxo > fluxoMedio * 1.6 && fluxo > 2 && agora - ultimaBatida > 180) {
      const intervalo = (agora - ultimaBatida) / 1000;
      if (intervalo > 0.25 && intervalo < 1.5) {
        intervalos.push(intervalo);
        if (intervalos.length > 12) intervalos.shift();
        const ord = [...intervalos].sort((a, b) => a - b);
        let bpm = 60 / ord[Math.floor(ord.length / 2)];
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        S.bpm += (bpm - S.bpm) * 0.3;
      }
      S.pulso = 1;
      S.batidas += 1;
      ultimaBatida = agora;
    } else {
      S.pulso *= Math.exp(-dt / 0.25);
    }
    S.t = t;
    return S;
  }

  return { S, processar };
}

// `audio` pode ser null (microfone): aí a fonte entra depois, por som.ligarFonte.
export function criarSom(audio) {
  const ctx = new AudioContext();
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 2048;
  analisador.smoothingTimeConstant = 0.6;
  // o analisador precisa ser puxado pelo destino pra processar, mas mudo:
  // quem toca no alto-falante é a fonte, direto (o microfone não pode voltar pra caixa)
  const mudo = ctx.createGain();
  mudo.gain.value = 0;
  analisador.connect(mudo);
  mudo.connect(ctx.destination);

  const som = { ctx, analisador, fonte: null, S: null, atualizar: null, ligarFonte, aoVivo: false };
  function ligarFonte(no, { audivel = true, aoVivo = false } = {}) {
    if (som.fonte) som.fonte.disconnect();
    som.fonte = no;
    som.aoVivo = aoVivo;
    no.connect(analisador);
    if (audivel) no.connect(ctx.destination);
  }
  if (audio) ligarFonte(ctx.createMediaElementSource(audio));

  const espectro = new Uint8Array(analisador.frequencyBinCount);
  const onda = new Uint8Array(analisador.fftSize);
  const escuta = criarEscuta({ sampleRate: ctx.sampleRate, fftSize: analisador.fftSize });

  function atualizar() {
    analisador.getByteFrequencyData(espectro);
    analisador.getByteTimeDomainData(onda);
    const tocando = som.aoVivo || (audio && !audio.paused);
    return escuta.processar(espectro, onda, performance.now(), tocando, audio && !som.aoVivo ? audio.currentTime : ctx.currentTime);
  }

  function loop() {
    atualizar();
    requestAnimationFrame(loop);
  }
  loop();

  som.S = escuta.S;
  som.atualizar = atualizar;
  // o espectro do quadro, pra quem quer ler o tom sem puxar o analisador de novo (puxar duas vezes
  // por quadro mexe na suavização que a escuta vê)
  som.espectro = espectro;
  return som;
}
