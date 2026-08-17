-- Roda só na primeira inicialização do volume do Postgres (docker-entrypoint-initdb.d).
-- Evolution API v2 exige seu próprio banco mesmo em deploy single-instance;
-- reaproveitamos o mesmo container Postgres do compose para evitar mais um serviço.
CREATE DATABASE evolution_api;
