import { tryBackend } from './backend';

/** One answer to "What type of app is this?". The backend's GET /app-types is the source of truth. */
export interface AppTypeInfo {
  id: string;
  label: string;
  category: string;
  description: string;
  default_port: number;
  required_files: string[];
  default_start_command: string;
  steps: string[];
  tips: string[];
}

/** Types whose container is started by a command the customer may want to change. */
export const usesStartCommand = (id: string) => !['auto', 'spa', 'static', 'dockerfile'].includes(id);

/**
 * Used in Demo Mode and when the backend is offline. Keep in sync with
 * core-platform/backend/src/modules/app-types/app-types.ts (labels, ports, start commands).
 */
export const FALLBACK_APP_TYPES: AppTypeInfo[] = [
  { id: 'auto', label: 'Not sure - detect it for me', category: 'Other', description: 'We look at your files and pick a setup.', default_port: 3000, required_files: [], default_start_command: '', steps: ['Look at the files in your repository', 'Use your Dockerfile if you have one, otherwise generate one', 'Build and start the container'], tips: [] },
  { id: 'flask', label: 'Flask', category: 'Python', description: 'Python web app built with Flask.', default_port: 5000, required_files: ['requirements.txt'], default_start_command: 'gunicorn --bind 0.0.0.0:$PORT app:app', steps: ['Use Python 3.12', 'pip install -r requirements.txt', 'Install gunicorn', 'Start: gunicorn app:app'], tips: ['requirements.txt must list flask'] },
  { id: 'fastapi', label: 'FastAPI', category: 'Python', description: 'Python API built with FastAPI.', default_port: 8000, required_files: ['requirements.txt'], default_start_command: 'uvicorn main:app --host 0.0.0.0 --port $PORT', steps: ['Use Python 3.12', 'pip install -r requirements.txt', 'Install uvicorn', 'Start: uvicorn main:app'], tips: ['requirements.txt must list fastapi'] },
  { id: 'django', label: 'Django', category: 'Python', description: 'Python web app built with Django.', default_port: 8000, required_files: ['manage.py'], default_start_command: '', steps: ['Use Python 3.12', 'pip install -r requirements.txt', 'Install gunicorn', 'Start: gunicorn <project>.wsgi'], tips: ['Add your domain to ALLOWED_HOSTS'] },
  { id: 'node', label: 'Node.js / Express', category: 'JavaScript', description: 'A Node.js server (Express, Fastify, NestJS...).', default_port: 3000, required_files: ['package.json'], default_start_command: 'npm start', steps: ['Use Node.js 20', 'npm install', 'npm run build (if present)', 'Start: npm start'], tips: ['Listen on process.env.PORT'] },
  { id: 'nextjs', label: 'Next.js', category: 'JavaScript', description: 'React framework with server-side rendering.', default_port: 3000, required_files: ['package.json'], default_start_command: 'npm start', steps: ['Use Node.js 20', 'npm install', 'npm run build', 'Start: npm start'], tips: [] },
  { id: 'spa', label: 'React / Vue / Vite (frontend only)', category: 'JavaScript', description: 'A frontend that builds to static files.', default_port: 80, required_files: ['package.json'], default_start_command: '', steps: ['npm install', 'npm run build', 'nginx serves the built files'], tips: [] },
  { id: 'static', label: 'Static HTML site', category: 'Other', description: 'Plain HTML/CSS/JS files. Nothing to build.', default_port: 80, required_files: ['index.html'], default_start_command: '', steps: ['nginx serves your files'], tips: [] },
  { id: 'go', label: 'Go', category: 'Go', description: 'A Go web server.', default_port: 8080, required_files: ['go.mod'], default_start_command: './app', steps: ['go build', 'Run the program'], tips: [] },
  { id: 'dockerfile', label: 'I have my own Dockerfile', category: 'Other', description: 'Any language. We build exactly what your Dockerfile says.', default_port: 3000, required_files: ['Dockerfile'], default_start_command: '', steps: ['docker build using your Dockerfile', 'Start the container'], tips: [] },
];

export async function loadAppTypes(useBackend: boolean): Promise<AppTypeInfo[]> {
  if (!useBackend) return FALLBACK_APP_TYPES;
  try { return await tryBackend('/app-types'); } catch { return FALLBACK_APP_TYPES; }
}
