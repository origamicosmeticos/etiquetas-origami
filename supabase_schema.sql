-- Tabelas necessárias para o Origami Etiquetas no Supabase

create table if not exists public.etiquetas_catalogo (
  ean text primary key,
  descricao text not null default '',
  preco numeric(10, 2) not null default 0,
  is_promo boolean not null default false,
  loja_ultima_edicao text not null default 'ORI',
  updated_at timestamptz not null default now()
);

create table if not exists public.fila_impressao_lotes (
  id bigint generated always as identity primary key,
  lote_nome text not null,
  loja_destino text not null check (loja_destino in ('ORI', 'SMT', 'CTR')),
  ean text not null,
  descricao text not null default '',
  preco numeric(10, 2) not null default 0,
  is_promo boolean not null default false,
  quantidade integer not null default 1,
  status text not null default 'pendente' check (status in ('pendente', 'impresso')),
  created_at timestamptz not null default now()
);

create index if not exists idx_fila_loja_status
  on public.fila_impressao_lotes (loja_destino, status);
