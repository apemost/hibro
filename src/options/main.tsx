import { createRoot } from 'react-dom/client';
import { OptionsApp } from './options-app';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<OptionsApp />);
}
