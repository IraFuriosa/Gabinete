import { defineConfig } from 'vite';

// base: './' -> caminhos relativos (./assets/...) para o bundle funcionar
// em GitHub Pages (user.github.io/repo/) e em domínio personalizado.
export default defineConfig({
    base: './',
    build: {
        outDir: 'dist',
    },
});
