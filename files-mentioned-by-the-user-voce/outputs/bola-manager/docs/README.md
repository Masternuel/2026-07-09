# Documentação do Bola Manager

Documentos que descrevem o sistema **atual**. Os relatórios de execução de cada etapa ficam em [`history/`](history/), como registro do que foi feito e validado na época.

## Operação e segurança
- [Operação multi-réplica](MULTI_REPLICA.md): Redis, locks, métricas privadas e réplicas no Railway.
- [Backup e restauração](BACKUP_RESTORE.md): runbook operacional do Firestore.
- [Configuração e revisão de segurança](SECURITY_HARDENING.md).
- [Staging de segurança](STAGING_SECURITY_SETUP.md): preparação externa.
- [Atualização de dependências](dependency-security.md).

## Desktop
- [Migração para o desktop](DESKTOP_MIGRATION.md): arquitetura offline, banco local, saves e rotação de backups.
- [Instalador Windows](DESKTOP_INSTALLER.md).
- [Editor local](DESKTOP_EDITOR.md) e [importação da base](DESKTOP_CATALOG_IMPORT.md).
- [Multiplayer P2P direto](DESKTOP_P2P.md).
- [Gemini no desktop](DESKTOP_GEMINI.md).
- [Investigação de intermitências](DESKTOP_INTERMITTENCIES.md).

## Jogo e interface
- [Entrosamento tático](TACTICAL_COHESION.md).
- [Cores e identidade dos clubes](CLUB_THEMES.md).
- [Menu principal](MAIN_MENU.md), [áudio](AUDIO.md) e [identidade visual](BRANDING.md).

## Histórico
Relatórios de etapa (`ETAPA_*`) e das fases de segurança (`PHASE*`) estão em [`history/`](history/). Eles registram decisões e resultados da época e podem citar caminhos, versões ou números que já mudaram. A auditoria técnica mais recente está em `AUDITORIA_TECNICA.md`, na raiz do repositório.
