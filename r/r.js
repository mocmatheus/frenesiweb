import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

/**
 * A página que um link de rolê abre.
 *
 * Quem chega aqui normalmente NÃO tem conta -- é justamente quem se quer
 * alcançar. Por isso a página não pede login para mostrar o rolê: ela
 * usa `role_publico`, a única função do banco executável por `anon`
 * (migração 48).
 *
 * ⚠️ O que ela mostra é um flyer: nome, data, local, capa. Contagem de
 * confirmados fica de fora de propósito, mesmo sendo agregada -- numa
 * página aberta viraria termômetro público de festa, e não é isso que o
 * link precisa fazer.
 */

const SUPABASE_URL = 'https://yhjfbthakxuqbhercxrz.supabase.co';
// Anon key: PÚBLICA POR DESENHO. Identifica o projeto e não concede nada
// sozinha -- e aqui concede ainda menos: `anon` executa exatamente uma
// função no schema inteiro.
const SUPABASE_ANON =
  'sb_publishable_2H1m2TPzL9RsVOh4Dfst3A_UkzGDLzc';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const $ = (id) => document.getElementById(id);

const FUSO = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', timeZone: FUSO,
});

const BAIRROS = {
  pinheiros: 'Pinheiros', vila_madalena: 'Vila Madalena', butanta: 'Butantã',
  augusta: 'Augusta', paulista: 'Paulista', vila_mariana: 'Vila Mariana', itaim: 'Itaim',
};

/**
 * O id vem do CAMINHO (/r/<uuid>), não de query string.
 *
 * ⚠️ Depende do redirect `/r/* -> /r/index.html` com status 200 no
 * netlify.toml. Sem ele a Netlify devolve 404 antes de este script
 * existir -- o link inteiro morre no servidor.
 */
function idDaUrl() {
  const m = location.pathname.match(/\/r\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

function falhar(msg) {
  $('estado').textContent = msg;
}

async function carregar() {
  const id = idDaUrl();
  if (!id) {
    falhar('Link inválido.');
    return;
  }

  const { data, error } = await sb.rpc('role_publico', { p_event_id: id });

  // Rolê despublicado ou inexistente volta NULO sem erro -- checar só o
  // `error` mostraria a página vazia sem dizer por quê.
  if (error || !data) {
    falhar('Este rolê não está mais disponível.');
    return;
  }

  $('nome').textContent = data.nome;
  $('quando').textContent = fmt.format(new Date(data.comeca_em));
  $('onde').textContent = `${data.local_nome} · ${BAIRROS[data.bairro] ?? data.bairro}`;

  if (data.capa_path) {
    const img = $('capa');
    img.src = `${SUPABASE_URL}/storage/v1/object/public/event-covers/${data.capa_path}`;
    img.alt = data.nome;
    img.classList.remove('escondido');
  }

  // ⚠️ Esquema custom, e não https, no botão: `mobile://role/<id>` é o
  // que o Expo Router entende. Universal link (abrir o app direto de um
  // https) precisa de assetlinks.json e apple-app-site-association com
  // as impressões digitais de assinatura, que só existem depois do app
  // assinado nas lojas. Até lá, este botão é a ponte.
  $('abrir').href = `mobile://role/${id}`;

  $('estado').classList.add('escondido');
  $('conteudo').classList.remove('escondido');
  document.title = `${data.nome} — Frenesi`;
}

carregar();
