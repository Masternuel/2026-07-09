import type { ClubChoice } from '../../types';
import { ResilientImage } from './ResilientImage';

interface ClubBackdropProps {
  club: Pick<ClubChoice, 'name' | 'code' | 'crestImageUrl'>;
}

export function ClubBackdrop({ club }: ClubBackdropProps) {
  const monogram = club.code.trim() || club.name.trim().slice(0, 3).toLocaleUpperCase('pt-BR');

  return (
    <div className="club-backdrop" aria-hidden="true">
      <span className="club-backdrop__stadium" />
      <span className="club-backdrop__atmosphere" />
      <span className="club-backdrop__horizon" />
      <span className="club-backdrop__crest">
        <ResilientImage
          src={club.crestImageUrl}
          alt=""
          className="club-backdrop__crest-image"
          fallback={<span className="club-backdrop__monogram">{monogram}</span>}
        />
      </span>
    </div>
  );
}
