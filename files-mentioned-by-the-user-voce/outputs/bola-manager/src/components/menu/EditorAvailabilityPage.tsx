import { ArrowUpRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { ManagerIdentity } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { getMenuCapabilities } from './mainMenuModel';
import { DesktopCatalogImport } from './DesktopCatalogImport';
import { InformationDisclosure } from '../shared/InformationDisclosure';

const editorFeatures = [
  ['Jogadores e atributos', 'Identidade, posição, idade, nacionalidade, camisa, destaque e atributos técnicos, físicos e de goleiro.'],
  ['Clubes e elencos', 'Identidade visual, estádio, localização, liga, orçamento inicial e reputação do clube.'],
  ['Ligas e torneios', 'País, divisão, nível, participantes, formatos, turnos e critérios de desempate.'],
  ['Banco de dados', 'Criação, edição, exclusão, imagens, backup JSON e importação Brasfoot na sua base individual.'],
];

export function EditorAvailabilityPage({ identity, onOpen }: { identity: ManagerIdentity; onOpen: () => void }) {
  const capabilities = getMenuCapabilities(identity.mode);
  const local = identity.mode === 'local';
  return (
    <section className="menu-editor" aria-labelledby="menu-editor-title">
      <header className="menu-page-heading"><div><h1 id="menu-editor-title">Editor</h1></div><Badge tone={capabilities.canEdit ? 'positive' : 'warning'}>{capabilities.canEdit ? local ? 'Local' : 'Sua conta' : 'Indisponível neste modo'}</Badge></header>
      <div className="menu-editor__access">
        <span className="menu-editor__access-icon">{capabilities.canEdit ? <ShieldCheck size={27} aria-hidden="true" /> : <LockKeyhole size={27} aria-hidden="true" />}</span>
        <div>
          <h2>{capabilities.canEdit ? 'Editar base do jogo' : identity.mode === 'demo' ? 'A demonstração não altera a base.' : 'A base pertence ao anfitrião.'}</h2>
          <p>{capabilities.canEdit ? local
            ? 'Catálogo salvo neste computador, sem sincronização com a nuvem.'
            : 'Catálogo individual da sua conta, com as permissões do servidor.'
            : identity.mode === 'peer' ? 'Você joga com a base do anfitrião. Esta identidade P2P não tem permissão para modificar o catálogo remoto.' : 'Consulte os recursos abaixo. Para editar, saia da demonstração e entre com uma conta Firebase.'}</p>
          {capabilities.canEdit && <>
            <p>As edições valem para novas carreiras; saves existentes mantêm sua base. Encerre sessões P2P e partidas antes de editar.</p>
            <Button variant="primary" icon={<ArrowUpRight size={16} aria-hidden="true" />} onClick={onOpen}>Abrir Editor</Button>
          </>}
        </div>
      </div>
      {local && <InformationDisclosure title="Importar uma base existente"><DesktopCatalogImport /></InformationDisclosure>}
      <InformationDisclosure title="Recursos e backup">
        <dl className="menu-feature-list">{editorFeatures.map(([title, description]) => <div key={title}><dt>{title}</dt><dd>{description}</dd></div>)}</dl>
        {local && <p className="menu-notice">Exporte um JSON pelo Editor para manter um backup do catálogo local.</p>}
      </InformationDisclosure>
      <InformationDisclosure title="Expansões planejadas">
        <section className="menu-planned"><header><h2>Expansões do Editor</h2><Badge tone="neutral">Planejado</Badge></header><p>Áreas dedicadas a técnicos, mercado e transferências, gestão financeira, reputação avançada e regras adicionais. Orçamento e reputação inicial de clubes e regras básicas de torneios já fazem parte do catálogo atual.</p><p>Essas expansões não são ações disponíveis neste menu.</p></section>
      </InformationDisclosure>
    </section>
  );
}
