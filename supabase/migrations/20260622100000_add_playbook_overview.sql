-- Vue globale du playbook: synthese structuree a partir des plays valides.

alter table public.playbooks
  add column if not exists overview jsonb;

comment on column public.playbooks.overview is
  'Synthese globale du playbook (doctrine, sequence, stages, principes) generee depuis les plays actifs.';