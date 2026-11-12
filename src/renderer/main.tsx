import { createRoot } from 'react-dom/client';
import { Pet } from './Pet';
import { Panels } from './Panels';
import './styles.css';

const panel = new URLSearchParams(location.search).get('panel');
const isPanel = panel === 'chat' || panel === 'work' || panel === 'settings';
document.documentElement.className = isPanel ? 'panel-page' : 'pet-page';
createRoot(document.getElementById('root')!).render(isPanel ? <Panels panel={panel} /> : <Pet />);
