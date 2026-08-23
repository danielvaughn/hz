import type { DesktopApi } from '../../shared/desktop';

export {};

declare global {
	interface Window {
		desktop: DesktopApi;
	}
}
