// Imported first by render.tsx: modules that read window.location at load time need it to exist.
(globalThis as any).window = { location: { hostname: 'dash.example' } };
