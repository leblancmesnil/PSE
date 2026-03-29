import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';

@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    // marked.parse returns a string; Angular's [innerHTML] binding sanitizes it automatically
    return marked.parse(value, { async: false }) as string;
  }
}
