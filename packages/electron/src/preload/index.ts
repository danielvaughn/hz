import { contextBridge } from 'electron';

const desktop = Object.freeze({
	platform: process.platform
});

contextBridge.exposeInMainWorld('desktop', desktop);
