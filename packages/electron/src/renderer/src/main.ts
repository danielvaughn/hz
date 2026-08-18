import './styles.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');

if (!target) throw new Error('Could not find the application mount point.');

mount(App, { target });
