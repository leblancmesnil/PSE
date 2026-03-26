export type Statut = 'a-demarrer' | 'en-cours' | 'livre';
export type Priorite = 'A' | 'B' | 'C';

export interface Chapitre {
  id: number;
  titre: string;
  couleur: string;
  icone: string;
}

export interface Mesure {
  id: number;
  chapitreId: number;
  titre: string;
  priorite: Priorite;
  statut: Statut;
  definitionOfDone: string;
}

export interface PseData {
  meta: {
    titre: string;
    sousTitre: string;
    datePublication: string;
    version: string;
  };
  chapitres: Chapitre[];
  mesures: Mesure[];
}

export const STATUT_LABELS: Record<Statut, string> = {
  'a-demarrer': 'À démarrer',
  'en-cours': 'En cours',
  'livre': 'Livré'
};

export const PRIORITE_LABELS: Record<Priorite, string> = {
  'A': 'Impact immédiat',
  'B': 'Structurant',
  'C': 'Long terme'
};
