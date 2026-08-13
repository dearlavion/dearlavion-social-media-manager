import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-wiki',
  standalone: true,
  templateUrl: './wiki.component.html',
  styleUrl: './wiki.component.css',
})
export class WikiComponent {
  @Output() back = new EventEmitter<void>();
}
