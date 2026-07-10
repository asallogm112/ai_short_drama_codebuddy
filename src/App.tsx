import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';
import { Create } from './pages/Create';
import { Detail } from './pages/Detail';
import { Materials } from './pages/Materials';
import { Layout } from './components/Layout';
import { ScriptsProvider } from './hooks/useScripts';
import { MaterialsProvider } from './hooks/useMaterials';

export default function App() {
  return (
    <BrowserRouter>
      <ScriptsProvider>
        <MaterialsProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="create" element={<Create />} />
              <Route path="materials" element={<Materials />} />
              <Route path="script/:id" element={<Detail />} />
            </Route>
          </Routes>
        </MaterialsProvider>
      </ScriptsProvider>
    </BrowserRouter>
  );
}
