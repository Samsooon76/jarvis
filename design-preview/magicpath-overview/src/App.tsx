import { Theme } from './settings/types';
import { JarvisOverviewPage } from './components/generated/JarvisOverviewPage';

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
      <JarvisOverviewPage />
    </>
  ); // %EXPORT_STATEMENT%
}

export default App;
