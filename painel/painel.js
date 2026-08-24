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
  await carregarEventos();
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

async function carregarEventos() {
  const { data, error } = await sb.from('events').select('*').order('comeca_em', { ascending: false });
  const corpo = $('lista');
  corpo.textContent = '';

  if (error) {
    $('lista-vazia').textContent = 'Não foi possível carregar. Recarrega a página.';
    $('lista-vazia').classList.remove('escondido');
    return;
  }

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
}

async function salvar(e) {
  e.preventDefault();
  mostrarErro($('erro-form'), '');
  mostrarErro($('ok-form'), '');
  const btn = $('btn-salvar');
  btn.disabled = true;

  const id = $('evento-id').value;
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

$('form-login').addEventListener('submit', entrar);
$('form-evento').addEventListener('submit', salvar);
$('btn-sair').addEventListener('click', sair);
$('btn-cancelar').addEventListener('click', limparForm);
$('btn-cep').addEventListener('click', buscarCep);
// Enter no campo de CEP busca em vez de enviar o formulario inteiro.
$('cep').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); buscarCep(); }
});

// Sessão expirada ou revogada em outra aba derruba esta também.
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT') mostrarLogin();
});

decidirAcesso();
