# IA local (sem internet, sem custo)

Configurações → **IA local** baixa uma única vez um modelo aberto (Qwen3 1.7B, licença Apache 2.0, ~1,2 GB) e passa a escrever os comentários da torcida, as respostas e as manchetes **no próprio computador**. Nenhuma chamada sai para a internet ao gerar, e publicar o jogo não gera custo nem requisições para o desenvolvedor.

Ordem de uso: **IA local** (quando ativada) → **chave Gemini pessoal** (opcional) → **respostas automáticas**. Qualquer falha cai para a etapa seguinte; a carreira nunca para por causa da IA.

## Leve para o PC

- Processo separado (`desktop/localAi/worker.mjs`) com **prioridade abaixo do normal**; se ele travar, o jogo continua.
- Somente CPU (sem CUDA/Vulkan no instalador), **no máximo 2 núcleos**, contexto de 1.024 tokens, **uma geração por vez**.
- O modelo só é carregado quando há algo para escrever e é **descarregado 90 s depois** (≈2 GB enquanto escreve, ≈150 MB parado).
- Tarefa curta: o jogo escolhe autor, papel e tom; o modelo escreve só os textos, com saída forçada em JSON (gramática). Ver `desktop/localAi/socialPrompt.mjs`.

Medido no app empacotado (Ryzen 9 5900XT, limitado a 2 threads): ~7 s por resposta, ~11–17 s por rodada do feed; 2,1 GB durante a escrita e 154 MB após descarregar.

## Download

Arquivo `Qwen_Qwen3-1.7B-Q4_K_M.gguf` (conversão pública de bartowski), fixado por tamanho e SHA-256 em `desktop/localAi/catalog.mjs`. Vai para `userData/models/`, fora de saves e exportações; um arquivo que não confere é apagado. "Remover modelo" apaga o arquivo e desativa a IA local.

No multiplayer P2P, a IA roda no computador do anfitrião.
