import { Theme } from './settings/types';
import { JarvisCallIntelligencePage } from './components/generated/JarvisCallIntelligencePage';

let theme: Theme = 'light';

function App() {
  function setTheme(theme: Theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  setTheme(theme);

  return (
    <>
      <JarvisCallIntelligencePage />
    </>
  ); // %EXPORT_STATEMENT%
}

export default App;
