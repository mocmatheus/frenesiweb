import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// Anon key: PÚBLICA POR DESENHO. Ela identifica o projeto e não concede
// nada sozinha -- todo acesso passa pela RLS com o JWT do usuário.
// Se algum dia alguém for colar a service_role aqui: não. Ver o
// comentário no topo do arquivo.
const SUPABASE_URL = 'https://yhjfbthakxuqbhercxrz.supabase.co';
const SUPABASE_ANON = 'sb_publishable_2H1m2TPzL9RsVOh4Dfst3A_UkzGDLzc';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const $ = (id) => document.getElementById(id);
const telaLogin = $('tela-login');
const telaPainel = $('tela-painel');

function mostrarErro(el, msg) { el.textContent = msg; }

// ─────────────────────────────────────────────────────────────
// Sessão
// ─────────────────────────────────────────────────────────────

async function entrar(e) {
  e.preventDefault();
  const btn = $('btn-entrar');
  btn.disabled = true;
  mostrarErro($('erro-login'), '');

  const { error } = await sb.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('senha').value,
  });

  if (error) {
    // Mensagem GENÉRICA de propósito: distinguir "e-mail não existe" de
    // "senha errada" entrega ao atacante quais contas existem, e a lista
    // de admins é justamente o que ele quer descobrir primeiro.
    mostrarErro($('erro-login'), 'E-mail ou senha incorretos.');
    btn.disabled = false;
    return;
  }

  await decidirAcesso();
  btn.disabled = false;
}

/**
 * Confere se a sessão é de admin e mostra o painel.
 *
 * ⚠️ Esta checagem é para a INTERFACE não mentir -- não mostrar um
 * formulário para quem não conseguiria salvar. Ela NÃO impede nada: quem
 * editar esta página vê o formulário e o INSERT volta negado pela RLS.
 */
async function decidirAcesso() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return mostrarLogin();

  const { data: admin, error } = await sb.rpc('sou_admin');

  if (error || !admin) {
    // Sessão válida mas sem privilégio: derruba na hora. Deixar logado
    // manteria um token vivo numa aba que não deveria estar aberta.
    await sb.auth.signOut();
    mostrarLogin();
    mostrarErro($('erro-login'), 'Esta conta não tem acesso ao painel.');
    return;
  }

  $('quem').textContent = session.user.email;
  telaLogin.classList.add('escondido');
  telaPainel.classList.remove('escondido');
  // As duas em paralelo: o contador da aba de Revisao precisa estar
  // certo ANTES de a pessoa decidir em qual aba ficar. Carregar a fila
  // so' ao clicar na aba esconderia justamente a fila cheia.
  await Promise.all([carregarResumo(), carregarEventos(), carregarFila()]);
}

function mostrarLogin() {
  telaPainel.classList.add('escondido');
  telaLogin.classList.remove('escondido');
}

async function sair() {
  await sb.auth.signOut();
  location.reload();
}

// ─────────────────────────────────────────────────────────────
// Eventos
// ─────────────────────────────────────────────────────────────

const FUSO = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: FUSO,
});

const BAIRROS = {
  pinheiros: 'Pinheiros', vila_madalena: 'Vila Madalena', butanta: 'Butantã',
  augusta: 'Augusta', paulista: 'Paulista', vila_mariana: 'Vila Mariana', itaim: 'Itaim',
};

/**
 * O resumo da operação, numa chamada só.
 *
 * ⚠️ Checar `ok`, não só `error`. `painel_resumo` recusa sessão sem
 * admin devolvendo {ok:false} SEM erro de transporte -- olhar só o
 * `error` faria a tela mostrar traços para sempre e parecer quebrada,
 * quando na verdade a resposta chegou e disse não.
 */
async function carregarResumo() {
  $('visao-relogio').textContent = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full', timeStyle: 'short', timeZone: FUSO,
  }).format(new Date()) + ' — horário de Brasília';

  const { data, error } = await sb.rpc('painel_resumo');
  if (error || !data?.ok) return;

  $('n-salas').textContent = data.salas_abertas;
  $('n-salas-nota').textContent = `de ${data.roles_publicados} rolês publicados`;

  $('n-denuncias').textContent = data.denuncias_abertas;
  $('n-quarentena').textContent = data.em_quarentena;
  $('n-midia').textContent = data.midia_pendente;

  // Ritmo medido na última hora. Um número de fila sem ritmo não diz se
  // vale esperar ou se algo travou -- 184 pendentes com 0/h é outro
  // problema que 184 com 120/h.
  const ritmo = data.midia_aprovada_1h;
  $('n-midia-nota').textContent = data.midia_pendente === 0
    ? 'fila vazia'
    : ritmo > 0
      ? `~${Math.round(ritmo / 60 * 10) / 10}/min · ${Math.ceil(data.midia_pendente / ritmo * 60)} min restantes`
      : 'nada processado na última hora';

  // ⚠️ Prazo estourado é o ÚNICO número aqui que é urgência. Os outros
  // são contexto, e por isso só ele pinta a tela.
  const estourou = data.prazo_estourado > 0;
  $('faixa-urgente').classList.toggle('escondido', !estourou);
  $('n-denuncias').classList.toggle('perigo', estourou);
  if (estourou) {
    $('urgente-titulo').textContent = data.prazo_estourado === 1
      ? '1 denúncia com prazo estourado'
      : `${data.prazo_estourado} denúncias com prazo estourado`;
    $('n-denuncias-nota').textContent = `${data.prazo_estourado} fora do prazo`;
  }
}

/** Sala aberta = dentro da janela E com quórum. Duas condições, não uma. */
const salaAberta = (ev) => ev.dentro_da_janela && ev.tem_quorum;

function pintarSalasAbertas(eventos) {
  const caixa = $('salas-abertas');
  caixa.textContent = '';
  const abertas = eventos.filter((e) => e.publicado && salaAberta(e));

  $('salas-vazias').classList.toggle('escondido', abertas.length > 0);
  caixa.classList.toggle('escondido', abertas.length === 0);

  for (const ev of abertas) {
    const linha = document.createElement('div');
    linha.className = 'linha-sala';

    const esq = document.createElement('div');
    esq.style.flexGrow = '1';
    const nome = document.createElement('div');
    nome.style.fontWeight = '600';
    nome.textContent = ev.nome;
    const onde = document.createElement('div');
    onde.style.fontSize = '12px';
    onde.style.color = 'var(--papel40)';
    onde.textContent = `${BAIRROS[ev.bairro] ?? ev.bairro} · fecha ${fmt.format(
      new Date(new Date(ev.termina_em ?? ev.comeca_em).getTime() + ev.sala_fecha_horas * 3600e3)
    )}`;
    esq.append(nome, onde);

    const dir = document.createElement('div');
    dir.style.textAlign = 'right';
    const n = document.createElement('div');
    n.style.fontWeight = '700';
    // ⚠️ Os DOIS números, sempre. Mostrar só "confirmados" faria o
    // curador jurar que a sala está povoada enquanto o feed dela está
    // vazio por moderação ou modo discreto.
    n.textContent = `${ev.visiveis} / ${ev.confirmados}`;
    const rot = document.createElement('div');
    rot.style.fontSize = '11px';
    rot.style.color = 'var(--papel40)';
    rot.textContent = 'visíveis / confirmados';
    dir.append(n, rot);

    linha.append(esq, dir);
    caixa.appendChild(linha);
  }
}

async function carregarEventos() {
  // Pela RPC, e não mais por `from('events')`: a tabela não tem como
  // dizer quantas pessoas confirmaram -- `event_attendance` não é
  // legível pelo painel, e é certo que não seja (a linha diz onde uma
  // pessoa específica vai estar). O agregado vem pronto do servidor.
  const { data: resp, error } = await sb.rpc('painel_eventos');
  const data = resp?.ok ? resp.eventos : null;
  const corpo = $('lista');
  corpo.textContent = '';

  if (error || !resp?.ok) {
    $('lista-vazia').textContent = resp && !resp.ok
      ? 'Esta conta não tem acesso aos rolês.'
      : 'Não foi possível carregar. Recarrega a página.';
    $('lista-vazia').classList.remove('escondido');
    return;
  }

  pintarSalasAbertas(data ?? []);

  $('lista-vazia').classList.toggle('escondido', (data ?? []).length > 0);

  for (const ev of data ?? []) {
    const tr = document.createElement('tr');

    // textContent e nunca innerHTML: o nome do evento é digitado por uma
    // pessoa, e concatenar HTML aqui seria abrir XSS numa página
    // privilegiada -- a última onde se quer isso.
    const td = (txt) => { const c = document.createElement('td'); c.textContent = txt; return c; };

    tr.appendChild(td(ev.nome));
    tr.appendChild(td(fmt.format(new Date(ev.comeca_em))));
    tr.appendChild(td(`${ev.local_nome} · ${BAIRROS[ev.bairro] ?? ev.bairro}`));

    // Confirmados, e quantos deles o feed consegue mostrar.
    const tdGente = document.createElement('td');
    tdGente.textContent = `${ev.confirmados}`;
    if (ev.min_confirmados > 0) {
      const meta = document.createElement('span');
      meta.style.color = 'var(--papel40)';
      meta.textContent = ` / min ${ev.min_confirmados}`;
      tdGente.appendChild(meta);
    }
    if (ev.visiveis !== ev.confirmados) {
      const dif = document.createElement('div');
      dif.style.fontSize = '12px';
      dif.style.color = 'var(--aviso)';
      dif.textContent = `${ev.visiveis} visíveis`;
      tdGente.appendChild(dif);
    }
    tr.appendChild(tdGente);

    // Estado da sala. Janela e quórum são condições separadas, e a
    // distinção importa: "fora da janela" espera o relógio, "sem quórum"
    // espera gente. Um selo só para as duas esconderia o que fazer.
    const tdSala = document.createElement('td');
    const seloSala = document.createElement('span');
    if (!ev.publicado) {
      seloSala.className = 'selo selo-fora';
      seloSala.textContent = '—';
    } else if (!ev.dentro_da_janela) {
      seloSala.className = 'selo selo-fora';
      seloSala.textContent = 'fora da janela';
    } else if (!ev.tem_quorum) {
      seloSala.className = 'selo selo-quorum';
      seloSala.textContent = 'sem quórum';
    } else {
      seloSala.className = 'selo selo-aberta';
      seloSala.textContent = 'aberta';
    }
    tdSala.appendChild(seloSala);
    tr.appendChild(tdSala);

    const tdEstado = document.createElement('td');
    const selo = document.createElement('span');
    selo.className = 'selo ' + (ev.publicado ? 'selo-pub' : 'selo-rasc');
    selo.textContent = ev.publicado ? 'publicado' : 'rascunho';
    tdEstado.appendChild(selo);
    tr.appendChild(tdEstado);

    const tdAcoes = document.createElement('td');
    const editar = document.createElement('button');
    editar.className = 'terciario';
    editar.textContent = 'Editar';
    editar.onclick = () => preencherForm(ev);
    tdAcoes.appendChild(editar);
    tr.appendChild(tdAcoes);

    corpo.appendChild(tr);
  }
}

/** ISO -> valor de <input datetime-local>, no fuso de São Paulo. */
function paraInputLocal(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('sv-SE', {
      dateStyle: 'short', timeStyle: 'short', timeZone: FUSO,
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function preencherForm(ev) {
  // Garante a seção certa antes de preencher: o formulário vive em
  // Rolês, e preencher um formulário escondido é um clique que não faz
  // nada visível -- o usuário conclui que o botão está quebrado.
  irPara('roles');
  $('evento-id').value = ev.id;
  $('nome').value = ev.nome ?? '';
  $('bairro').value = ev.bairro ?? 'pinheiros';
  $('local_nome').value = ev.local_nome ?? '';
  $('endereco').value = ev.endereco ?? '';
  $('comeca_em').value = paraInputLocal(ev.comeca_em);
  $('termina_em').value = paraInputLocal(ev.termina_em);
  $('lineup').value = ev.lineup ?? '';
  $('descricao').value = ev.descricao ?? '';
  $('sala_abre_horas').value = ev.sala_abre_horas ?? 48;
  $('sala_fecha_horas').value = ev.sala_fecha_horas ?? 24;
  $('min_confirmados').value = ev.min_confirmados ?? 0;
  $('publicado').checked = !!ev.publicado;
  $('titulo-form').textContent = 'Editando: ' + ev.nome;
  $('btn-cancelar').classList.remove('escondido');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Zonas do MVP, e as palavras que costumam apontar para cada uma.
 *
 * ⚠️ O bairro dos Correios NÃO é uma das 7 zonas do app, e isso não é
 * um detalhe: são taxonomias diferentes. O CEP da Avenida Paulista
 * devolve "Bela Vista", não "Paulista" -- medido. Um mapeamento
 * automático que confiasse no nome erraria calado, e um evento com a
 * zona errada aparece para a sala errada.
 *
 * Por isso isto SUGERE e não decide: o palpite marca o select, mostra de
 * onde veio, e a pessoa confirma ou troca.
 */
const PISTAS_ZONA = {
  pinheiros: ['pinheiros', 'alto de pinheiros'],
  vila_madalena: ['vila madalena', 'sumarezinho'],
  butanta: ['butanta', 'butantã', 'rio pequeno', 'cidade universitaria'],
  augusta: ['consolacao', 'consolação', 'cerqueira cesar', 'cerqueira césar'],
  paulista: ['bela vista', 'jardim paulista', 'paraiso', 'paraíso'],
  vila_mariana: ['vila mariana', 'vila clementino', 'saude', 'saúde'],
  itaim: ['itaim bibi', 'itaim', 'vila olimpia', 'vila olímpia'],
};

const semAcento = (s) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function palpitarZona(bairroCorreios) {
  const b = semAcento(bairroCorreios);
  if (!b) return null;
  for (const [zona, pistas] of Object.entries(PISTAS_ZONA)) {
    if (pistas.some((p) => semAcento(p) === b)) return zona;
  }
  return null;
}

async function buscarCep() {
  const bruto = ($('cep').value || '').replace(/\D/g, '');
  mostrarErro($('erro-cep'), '');
  $('achado-cep').classList.add('escondido');

  if (bruto.length !== 8) {
    mostrarErro($('erro-cep'), 'CEP precisa ter 8 dígitos.');
    return;
  }

  const btn = $('btn-cep');
  btn.disabled = true;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${bruto}/json/`);
    const d = await r.json();

    // ⚠️ CEP inexistente responde HTTP 200 com {"erro":"true"}.
    // Checar só `r.ok` trataria "não existe" como sucesso e deixaria o
    // formulário em branco sem dizer por quê -- medido contra a API.
    if (!r.ok || d.erro) {
      mostrarErro($('erro-cep'), 'CEP não encontrado.');
      return;
    }

    if (d.logradouro) $('endereco').value = d.logradouro;

    const zona = palpitarZona(d.bairro);
    if (zona) $('bairro').value = zona;

    const caixa = $('achado-cep');
    caixa.textContent = zona
      ? `${d.logradouro || '(sem logradouro)'} — bairro "${d.bairro}", em ${d.localidade}/${d.uf}. `
        + `Sugeri a zona correspondente; confira se está certa.`
      : `${d.logradouro || '(sem logradouro)'} — bairro "${d.bairro}", em ${d.localidade}/${d.uf}. `
        + `Este bairro não corresponde a nenhuma das 7 zonas do MVP — escolha a zona à mão.`;
    caixa.classList.remove('escondido');
  } catch (e) {
    mostrarErro($('erro-cep'), 'Não foi possível consultar o CEP agora.');
  } finally {
    btn.disabled = false;
  }
}

function limparForm() {
  $('form-evento').reset();
  $('evento-id').value = '';
  $('sala_abre_horas').value = 48;
  $('sala_fecha_horas').value = 24;
  $('min_confirmados').value = 0;
  $('titulo-form').textContent = 'Novo evento';
  $('btn-cancelar').classList.add('escondido');
  mostrarErro($('erro-form'), '');
  mostrarErro($('ok-form'), '');
  mostrarErro($('erro-cep'), '');
  $('achado-cep').classList.add('escondido');
  mostrarErro($('erro-capa'), '');
  $('capa').value = '';
  $('previa-capa').classList.add('escondido');
}

/**
 * Sobe a capa selecionada, se houver.
 *
 * Devolve o caminho novo, ou `undefined` quando nada foi escolhido --
 * que e' o sinal de "nao mexa na coluna".
 *
 * ⚠️ O nome do arquivo carrega um carimbo de tempo. Sem ele, reenviar a
 * capa de um evento gravaria no mesmo caminho, e a URL publica -- que a
 * CDN e o app guardam justamente por ser estavel -- continuaria
 * servindo a imagem velha por horas.
 */
async function subirCapa(eventoId) {
  const arquivo = $('capa').files && $('capa').files[0];
  if (!arquivo) return undefined;

  if (arquivo.size > 2 * 1024 * 1024) {
    throw new Error('A capa passa de 2 MB. Reduza e tente de novo.');
  }

  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[arquivo.type];
  if (!ext) throw new Error('Formato não aceito. Use JPG, PNG ou WebP.');

  const pasta = eventoId || 'novos';
  const caminho = `${pasta}/${Date.now()}.${ext}`;

  const { error } = await sb.storage
    .from('event-covers')
    // `cacheControl` explicito: o padrao do supabase-js e' 1 hora.
    // Medido numa capa subida sem ele: `public, max-age=3600`.
    //
    // Uma hora nao e' errado, e' curto -- a capa de um role nao muda, e
    // revalidar de hora em hora joga fora o que o bucket publico
    // comprou. 7 dias e' seguro porque o caminho carrega carimbo de
    // tempo: trocar a capa gera outra URL em vez de sobrescrever esta.
    //
    // ⚠️ Conferir com `curl -I` engana: o HEAD do Storage devolve
    // `no-cache` mesmo quando o GET devolve o valor certo.
    .upload(caminho, arquivo, {
      contentType: arquivo.type,
      cacheControl: '604800',
      upsert: false,
    });

  if (error) throw new Error(error.message || 'Falha ao enviar a capa.');
  return caminho;
}

async function salvar(e) {
  e.preventDefault();
  mostrarErro($('erro-form'), '');
  mostrarErro($('ok-form'), '');
  const btn = $('btn-salvar');
  btn.disabled = true;

  const id = $('evento-id').value;

  // ⚠️ A capa sobe ANTES do insert/update, e um erro aqui ABORTA o
  // salvamento. Salvar o evento e engolir a falha da imagem deixaria um
  // rolê publicado sem flyer e sem ninguem saber por que.
  let capaPath;
  try {
    capaPath = await subirCapa(id);
  } catch (err) {
    mostrarErro($('erro-capa'), err.message || 'Não foi possível enviar a capa.');
    btn.disabled = false;
    return;
  }

  const linha = {
    nome: $('nome').value.trim(),
    bairro: $('bairro').value,
    local_nome: $('local_nome').value.trim(),
    endereco: $('endereco').value.trim() || null,
    comeca_em: new Date($('comeca_em').value).toISOString(),
    termina_em: $('termina_em').value ? new Date($('termina_em').value).toISOString() : null,
    lineup: $('lineup').value.trim() || null,
    descricao: $('descricao').value.trim() || null,
    sala_abre_horas: Number($('sala_abre_horas').value),
    sala_fecha_horas: Number($('sala_fecha_horas').value),
    min_confirmados: Number($('min_confirmados').value),
    publicado: $('publicado').checked,
  };

  // `undefined` = nao mexeram na capa, entao a coluna nao entra no
  // update e o valor antigo permanece. Distinguir isso de `null` importa:
  // null apagaria a capa de quem so' quis corrigir o horario.
  if (capaPath !== undefined) linha.capa_path = capaPath;

  const { error } = id
    ? await sb.from('events').update(linha).eq('id', id)
    : await sb.from('events').insert(linha);

  if (error) {
    // A RLS nega em silêncio no update (0 linhas) e com erro no insert.
    // Os dois casos chegam aqui como "não deu" -- e é o suficiente:
    // detalhe de policy não ajuda quem usa e ajuda quem ataca.
    mostrarErro($('erro-form'), 'Não foi possível salvar. ' + (error.message ?? ''));
    btn.disabled = false;
    return;
  }

  mostrarErro($('ok-form'), id ? 'Evento atualizado.' : 'Evento criado.');
  limparForm();
  await carregarEventos();
  btn.disabled = false;
}

// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Revisão humana (SAFE-08)
// ─────────────────────────────────────────────────────────────
//
// A quarentena automática tira do ar sozinha desde a migração 14. Esta
// tela é o outro lado, que nunca existiu: sem ela, um falso positivo
// deixa alguém fora do ar indefinidamente.

const RAZOES = {
  menor_de_idade: 'Menor de idade',
  nudez_sexual: 'Nudez sexual',
  violencia: 'Violência',
  assedio: 'Assédio',
  perfil_falso: 'Perfil falso',
  discurso_de_odio: 'Discurso de ódio',
  outro: 'Outro',
};

// As mesmas três que a migração 14 usa para quarentenar na hora.
const GRAVES = new Set(['menor_de_idade', 'nudez_sexual', 'violencia']);

const SECOES = ['visao', 'revisao', 'roles'];
const PAINEL_DE = { visao: 'painel-visao', revisao: 'painel-revisao', roles: 'painel-eventos' };

function irPara(qual) {
  for (const s of SECOES) {
    $('ir-' + s).classList.toggle('ativa', s === qual);
    $(PAINEL_DE[s]).classList.toggle('escondido', s !== qual);
  }
  window.scrollTo({ top: 0 });
}

function atualizarContador(n) {
  const c = $('contador-fila');
  c.textContent = String(n);
  c.classList.toggle('escondido', n === 0);
}

/**
 * URLs assinadas da prova.
 *
 * ⚠️ `createSignedUrls` devolve a negação DENTRO de cada item, não no
 * `error` do topo -- falha parcial passa calada. Daí o filtro item a
 * item em vez de confiar só no erro geral.
 *
 * 300s de validade: tempo de olhar e decidir. A policy do banco só
 * libera enquanto a denúncia estiver aberta, então uma URL vazada
 * também morre quando o caso é julgado.
 */
async function assinarProvas(midia) {
  const itens = Array.isArray(midia) ? midia : [];
  if (itens.length === 0) return [];

  const { data, error } = await sb.storage
    .from('profile-media')
    .createSignedUrls(itens.map((m) => m.path), 300);
  if (error) return [];

  return (data ?? [])
    .map((r, i) => (r && r.signedUrl ? { url: r.signedUrl, tipo: itens[i] && itens[i].type } : null))
    .filter(Boolean);
}

function montarCard(d) {
  const grave = GRAVES.has(d.razao);
  const outras = Number(d.outras_graves_abertas || 0);

  const card = document.createElement('div');
  card.className = 'caixa denuncia' + (grave ? ' grave' : '');

  const etiquetas = document.createElement('div');
  etiquetas.className = 'etiquetas';
  const etiqueta = (txt, alerta) => {
    const e = document.createElement('span');
    e.className = 'etiqueta' + (alerta ? ' alerta' : '');
    e.textContent = txt;
    etiquetas.appendChild(e);
  };
  etiqueta(RAZOES[d.razao] || d.razao, grave);
  if (d.quarentenado_em) etiqueta('fora do ar desde ' + fmt.format(new Date(d.quarentenado_em)), true);
  if (outras > 0) etiqueta(outras + (outras === 1 ? ' outra grave aberta' : ' outras graves abertas'));
  etiqueta('denunciada em ' + fmt.format(new Date(d.criada_em)));
  if (d.tem_mensagens) etiqueta('tem conversa preservada');
  card.appendChild(etiquetas);

  // textContent e nunca innerHTML: `detalhes` e' texto digitado pelo
  // denunciante. Concatenar HTML aqui seria XSS na pagina privilegiada.
  const nome = document.createElement('h2');
  nome.style.margin = '0 0 6px';
  nome.textContent = d.denunciado_nome;
  card.appendChild(nome);

  if (d.detalhes) {
    const det = document.createElement('p');
    det.className = 'sub';
    det.style.margin = '0';
    det.textContent = '“' + d.detalhes + '”';
    card.appendChild(det);
  }

  const provas = document.createElement('div');
  provas.className = 'provas';
  card.appendChild(provas);

  const nota = document.createElement('input');
  nota.maxLength = 300;
  nota.placeholder = 'Nota da decisão (fica no registro)';
  card.appendChild(nota);

  const acoes = document.createElement('div');
  acoes.className = 'acoes-linha';
  acoes.style.marginTop = '12px';

  const bImp = document.createElement('button');
  bImp.type = 'button';
  bImp.className = 'secundario';
  // ⚠️ O rótulo diz a consequência REAL, não a genérica. Com outra
  // denúncia grave aberta, julgar improcedente NÃO devolve ao ar -- e um
  // botão prometendo o contrário faria o revisor achar que resolveu.
  bImp.textContent = d.quarentenado_em
    ? (outras > 0 ? 'Improcedente — segue fora (há outra grave)' : 'Improcedente — devolver ao ar')
    : 'Improcedente';

  const bProc = document.createElement('button');
  bProc.type = 'button';
  bProc.className = 'perigo';
  bProc.textContent = d.quarentenado_em ? 'Procedente — manter fora' : 'Procedente';

  acoes.appendChild(bImp);
  acoes.appendChild(bProc);
  card.appendChild(acoes);

  const saida = document.createElement('p');
  saida.className = 'erro';
  card.appendChild(saida);

  const julgar = async (decisao) => {
    bImp.disabled = true;
    bProc.disabled = true;
    saida.className = 'erro';
    saida.textContent = '';

    const { data, error } = await sb.rpc('revisar_denuncia', {
      p_report_id: d.report_id,
      p_decisao: decisao,
      p_nota: nota.value || null,
    });

    // ⚠️ Checar `data.ok`, e nao so' `error`. Um no-op (denuncia ja'
    // julgada por outro revisor) volta SEM erro de transporte -- tratar
    // isso como sucesso faria o botao parecer morto.
    if (error) {
      saida.textContent = 'Não foi possível registrar. Tenta de novo.';
      bImp.disabled = false;
      bProc.disabled = false;
      return;
    }

    if (!data || !data.ok) {
      const motivos = {
        nao_autorizado: 'Esta conta não pode revisar.',
        decisao_invalida: 'Decisão inválida.',
        nao_encontrada: 'Denúncia não encontrada.',
        ja_revisada: 'Alguém já julgou esta denúncia.',
      };
      const razao = data && data.reason;
      saida.textContent = motivos[razao] || 'Não foi possível registrar.';
      if (razao !== 'ja_revisada') {
        bImp.disabled = false;
        bProc.disabled = false;
      }
      return;
    }

    saida.className = 'ok';
    if (data.quarentena_levantada) {
      saida.textContent = 'Registrado. O perfil voltou ao ar.';
    } else if (d.quarentenado_em) {
      saida.textContent = 'Registrado. O perfil segue fora do ar.';
    } else {
      saida.textContent = 'Registrado.';
    }

    // Recarrega para a fila e o contador refletirem a decisão.
    setTimeout(carregarFila, 1200);
  };

  bImp.addEventListener('click', () => julgar('improcedente'));
  bProc.addEventListener('click', () => julgar('procedente'));

  return { card, provas };
}

async function carregarFila() {
  const alvo = $('fila');
  alvo.textContent = '';
  mostrarErro($('erro-fila'), '');

  const { data, error } = await sb.rpc('fila_revisao');
  if (error) {
    mostrarErro($('erro-fila'), 'Não foi possível carregar a fila.');
    return;
  }

  const fila = data || [];
  atualizarContador(fila.length);
  $('fila-vazia').classList.toggle('escondido', fila.length > 0);

  for (const d of fila) {
    const montado = montarCard(d);
    alvo.appendChild(montado.card);

    // Assina DEPOIS de anexar: a lista aparece na hora e cada prova
    // entra quando chega. Esperar todas as assinaturas deixaria a tela
    // vazia enquanto o revisor já poderia estar lendo os motivos.
    assinarProvas(d.midia).then((urls) => {
      if (urls.length === 0) {
        const p = document.createElement('p');
        p.className = 'semprova';
        p.textContent = 'Sem mídia preservada nesta denúncia.';
        montado.provas.appendChild(p);
        return;
      }
      for (const u of urls) {
        const el = document.createElement(u.tipo === 'video' ? 'video' : 'img');
        el.src = u.url;
        if (u.tipo === 'video') el.controls = true;
        montado.provas.appendChild(el);
      }
    });
  }
}

for (const s of SECOES) $('ir-' + s).addEventListener('click', () => irPara(s));

$('btn-ver-fila').addEventListener('click', () => irPara('revisao'));

$('form-login').addEventListener('submit', entrar);
$('form-evento').addEventListener('submit', salvar);
$('btn-sair').addEventListener('click', sair);
$('btn-cancelar').addEventListener('click', limparForm);
$('btn-cep').addEventListener('click', buscarCep);

// Previa local por object URL: mostra o enquadramento 16:9 real ANTES de
// subir, que e' quando ainda da' para trocar a imagem.
$('capa').addEventListener('change', () => {
  mostrarErro($('erro-capa'), '');
  const f = $('capa').files && $('capa').files[0];
  const img = $('previa-capa');
  if (!f) { img.classList.add('escondido'); return; }
  img.src = URL.createObjectURL(f);
  img.classList.remove('escondido');
});
// Enter no campo de CEP busca em vez de enviar o formulario inteiro.
$('cep').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); buscarCep(); }
});

// Sessão expirada ou revogada em outra aba derruba esta também.
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') mostrarLogin();
});

decidirAcesso();
