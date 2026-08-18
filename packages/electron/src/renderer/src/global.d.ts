export {};

declare global {
	interface Window {
		desktop: Readonly<{
			platform: NodeJS.Platform;
		}>;
	}
}
