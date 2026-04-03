import './styles/tokens.css';
import './styles/theme-canvas.css';
import './styles/shared.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;