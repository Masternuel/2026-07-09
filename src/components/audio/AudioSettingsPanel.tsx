import { useId, type CSSProperties } from 'react';
import { Play, Volume2 } from 'lucide-react';
import { useMusic } from '../../audio/MusicProvider';
import type { AudioPreferences } from '../../preferences/userPreferences';

const volumeOptions = [
  ['masterVolume', 'Volume geral', 'Controla todas as categorias de áudio.'],
  ['musicVolume', 'Volume da música', 'Trilha sonora durante o gerenciamento do clube.'],
  ['effectsVolume', 'Volume dos efeitos', 'Som de teste disponível; efeitos de partida ainda não foram adicionados.'],
  ['interfaceVolume', 'Volume da interface', 'Som de teste disponível; as ações de interface ainda são silenciosas.'],
] as const;

const switchOptions = [
  ['musicEnabled', 'Ativar música', 'Permite reproduzir a trilha sonora do jogo.'],
  ['shuffle', 'Reprodução aleatória', 'Alterna as músicas sem seguir a ordem da lista.'],
  ['showNowPlaying', 'Mostrar música atual', 'Exibe um aviso breve quando uma nova faixa começa.'],
] as const;

export function AudioSettingsPanel() {
  const { preferences, updateAudio, previewSound } = useMusic();
  const id = useId();

  function update(patch: Partial<AudioPreferences>) {
    void updateAudio(patch);
  }

  return (
    <section className="settings-section audio-settings" id="settings-audio" aria-labelledby={`${id}-heading`}>
      <header><div><p className="eyebrow">TRILHA E VOLUMES</p><h2 id={`${id}-heading`}>Áudio</h2></div><Volume2 size={18} aria-hidden="true" /></header>
      <div className="audio-settings__volumes">
        {volumeOptions.map(([key, label, description]) => {
          const inputId = `${id}-${key}`;
          const descriptionId = `${inputId}-description`;
          const value = preferences[key];
          return (
            <div className="audio-volume" key={key}>
              <div className="audio-volume__copy"><label htmlFor={inputId}>{label}</label><small id={descriptionId}>{description}</small></div>
              <div className="audio-volume__control">
                <input
                  id={inputId}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  aria-describedby={descriptionId}
                  aria-valuetext={`${value}%`}
                  style={{ '--volume': `${value}%` } as CSSProperties}
                  onChange={(event) => update({ [key]: Number(event.target.value) })}
                />
                <output htmlFor={inputId}>{value}%</output>
                {(key === 'effectsVolume' || key === 'interfaceVolume') && (
                  <button
                    type="button"
                    className="audio-volume__preview"
                    aria-label={`Testar ${key === 'effectsVolume' ? 'volume dos efeitos' : 'volume da interface'}`}
                    title="Testar som"
                    onClick={() => previewSound(key === 'effectsVolume' ? 'effects' : 'interface')}
                  ><Play size={14} aria-hidden="true" /></button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {switchOptions.map(([key, label, description]) => (
        <div className="setting-row audio-setting-row" key={key}>
          <span><strong id={`${id}-${key}-label`}>{label}</strong><small id={`${id}-${key}-description`}>{description}</small></span>
          <button type="button" className="audio-switch" role="switch" aria-checked={preferences[key]} aria-labelledby={`${id}-${key}-label`} aria-describedby={`${id}-${key}-description`} onClick={() => update({ [key]: !preferences[key] })}><i aria-hidden="true" /></button>
        </div>
      ))}
      <footer className="audio-settings__footer"><span>As alterações são aplicadas imediatamente e salvas no seu perfil.</span></footer>
    </section>
  );
}
