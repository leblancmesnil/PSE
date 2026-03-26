import { Injectable, signal, computed } from '@angular/core';
import { PseData, Mesure, Chapitre, Statut, Priorite } from '../models/mesure.model';
import data from '../../assets/data/mesures.json';

@Injectable({ providedIn: 'root' })
export class PseService {
  private readonly data: PseData = data as PseData;

  readonly meta = this.data.meta;
  readonly chapitres = signal<Chapitre[]>(this.data.chapitres);
  readonly mesures = signal<Mesure[]>(this.data.mesures);

  readonly filtreTexte = signal('');
  readonly filtreChapitre = signal<number | null>(null);
  readonly filtrePriorite = signal<Priorite | null>(null);
  readonly filtreStatut = signal<Statut | null>(null);

  readonly mesuresFiltrees = computed(() => {
    let result = this.mesures();
    const texte = this.filtreTexte().toLowerCase().trim();
    const chapitre = this.filtreChapitre();
    const priorite = this.filtrePriorite();
    const statut = this.filtreStatut();

    if (texte) {
      result = result.filter(m =>
        m.titre.toLowerCase().includes(texte) ||
        m.id.toString().includes(texte)
      );
    }
    if (chapitre !== null) {
      result = result.filter(m => m.chapitreId === chapitre);
    }
    if (priorite !== null) {
      result = result.filter(m => m.priorite === priorite);
    }
    if (statut !== null) {
      result = result.filter(m => m.statut === statut);
    }
    return result;
  });

  readonly stats = computed(() => {
    const all = this.mesures();
    return {
      total: all.length,
      aDemarrer: all.filter(m => m.statut === 'a-demarrer').length,
      enCours: all.filter(m => m.statut === 'en-cours').length,
      livre: all.filter(m => m.statut === 'livre').length,
      prioriteA: all.filter(m => m.priorite === 'A').length,
      prioriteB: all.filter(m => m.priorite === 'B').length,
      prioriteC: all.filter(m => m.priorite === 'C').length,
    };
  });

  getChapitre(id: number): Chapitre | undefined {
    return this.chapitres().find(c => c.id === id);
  }
}
