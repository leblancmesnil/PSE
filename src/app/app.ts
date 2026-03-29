import { Component, inject } from '@angular/core';
import { PseService } from './services/pse.service';
import { STATUT_LABELS, PRIORITE_LABELS, Statut, Priorite } from './models/mesure.model';
import { FormsModule } from '@angular/forms';
import { MarkdownPipe } from './pipes/markdown.pipe';

@Component({
  selector: 'app-root',
  imports: [FormsModule, MarkdownPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly pse = inject(PseService);
  protected readonly statutLabels = STATUT_LABELS;
  protected readonly prioriteLabels = PRIORITE_LABELS;
  protected readonly statuts: Statut[] = ['a-demarrer', 'en-cours', 'livre'];
  protected readonly priorites: Priorite[] = ['A', 'B', 'C'];

  protected mesureSelectionnee: number | null = null;
  protected searchText = '';

  onSearch(value: string) {
    this.pse.filtreTexte.set(value);
  }

  onFiltreChapitre(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    this.pse.filtreChapitre.set(val ? Number(val) : null);
  }

  onFiltrePriorite(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    this.pse.filtrePriorite.set(val ? val as Priorite : null);
  }

  onFiltreStatut(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    this.pse.filtreStatut.set(val ? val as Statut : null);
  }

  resetFiltres() {
    this.searchText = '';
    this.pse.filtreTexte.set('');
    this.pse.filtreChapitre.set(null);
    this.pse.filtrePriorite.set(null);
    this.pse.filtreStatut.set(null);
  }

  toggleDetail(id: number) {
    this.mesureSelectionnee = this.mesureSelectionnee === id ? null : id;
  }

  getStatutClass(statut: Statut): string {
    return `statut-${statut}`;
  }

  getPrioriteClass(priorite: Priorite): string {
    return `priorite-${priorite.toLowerCase()}`;
  }

  getProgressPercent(): number {
    const s = this.pse.stats();
    if (s.total === 0) return 0;
    return Math.round((s.livre / s.total) * 100);
  }
}
