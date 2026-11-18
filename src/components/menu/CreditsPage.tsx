import { Code2, Gamepad2 } from 'lucide-react';

export function CreditsPage() {
  return (
    <section className="menu-credits" aria-labelledby="menu-credits-title">
      <header className="menu-page-heading"><div><p className="eyebrow">SOBRE O JOGO</p><h1 id="menu-credits-title">Bola Manager</h1><p>Gestão de futebol, carreiras e temporadas compartilhadas.</p></div><Gamepad2 size={26} aria-hidden="true" /></header>
      <div className="menu-credits__intro"><p>Escolha um clube, prepare o elenco e conduza sua equipe ao longo da temporada. Cada carreira mantém sua própria sala, managers e progresso.</p><p>O launcher oferece motor e saves locais, com jogadores fictícios na base inicial. No navegador, uma conta Firebase permite acessar carreiras e o Editor da Base. O modo demonstração tem limitações próprias.</p></div>
      <div className="menu-section-title"><Code2 size={18} aria-hidden="true" /><h2>Tecnologia utilizada</h2></div>
      <dl className="menu-feature-list"><div><dt>Interface</dt><dd>React, TypeScript, Vite e ícones Lucide.</dd></div><div><dt>Conta e serviços web</dt><dd>Firebase Authentication, Firestore e comunicação em tempo real com Socket.IO.</dd></div><div><dt>Launcher para Windows</dt><dd>Electron, persistência local e multiplayer direto via WebRTC.</dd></div></dl>
      <p className="menu-notice">O P2P depende do computador do anfitrião conectado. Integração Steam, matchmaking, descoberta pública e migração de anfitrião não estão implementados.</p>
    </section>
  );
}
