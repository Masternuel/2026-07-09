const EDITORIAL_KEYS = new Set(["n1", "n2", "n3", "n4"]);

export function buildCanonicalEditorials({ clubName, clubId }, requestedPosts = []) {
  const safeClubName = String(clubName ?? clubId ?? "O clube").trim() || "O clube";
  const safeClubCode = String(clubId ?? "CLB").trim().toUpperCase() || "CLB";
  const requestedKeys = new Set(
    requestedPosts
      .map((post) => String(post?.id ?? "").trim())
      .filter((key) => EDITORIAL_KEYS.has(key)),
  );
  const catalog = [
    {
      id: "n1",
      source: "Linha de Fundo",
      sourceType: "imprensa",
      headline: `${safeClubName} chega à rodada com ataque em alta`,
      body: "A equipe marcou 11 gols nas últimas cinco rodadas e ganhou força na disputa.",
      reactions: 284,
      tag: "Análise",
    },
    {
      id: "n2",
      source: safeClubName,
      sourceType: "clube",
      headline: "Torcida prepara casa cheia para o próximo duelo",
      body: `O ${safeClubName} confirmou programação especial antes da partida.`,
      reactions: 612,
      tag: "Clube",
    },
    {
      id: "n3",
      source: "Capitão do elenco",
      sourceType: "jogador",
      headline: "“É jogo para assumir responsabilidade.”",
      body: `O capitão falou com a imprensa após o treino do ${safeClubName}.`,
      reactions: 437,
      tag: "Vestiário",
    },
    {
      id: "n4",
      source: `Torcida ${safeClubCode}`,
      sourceType: "torcida",
      headline: `Apoio preparado para empurrar o ${safeClubName}`,
      body: "A organizada promete uma recepção especial na entrada da equipe.",
      reactions: 793,
      tag: "Torcida",
    },
  ];
  return catalog.filter((post) => requestedKeys.has(post.id));
}
