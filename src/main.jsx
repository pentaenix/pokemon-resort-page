import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { getHashRoute, loadSiteData } from './lib/data.js';
import { Footer, Header, LegalBanner } from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Atlas from './pages/Atlas.jsx';
import Ontology from './pages/Ontology.jsx';
import Board from './pages/Board.jsx';
import Plan from './pages/Plan.jsx';
import ConciergeResearch from './pages/ConciergeResearch.jsx';
import SourceGuide from './pages/SourceGuide.jsx';
import Docs from './pages/Docs.jsx';
import Ideas from './pages/Ideas.jsx';
import Milestones from './pages/Milestones.jsx';
import Legal from './pages/Legal.jsx';

const pages = {
  '/': Home,
  '/atlas': Atlas,
  '/ontology': Ontology,
  '/board': Board,
  '/milestones': Plan,
  '/plan': Plan,
  '/ideas': Ideas,
  '/build': Milestones,
  '/research': ConciergeResearch,
  '/concierge': ConciergeResearch,
  '/docs': Docs,
  '/source': SourceGuide,
  '/legal': Legal,
};

function normalizeRoute(route) {
  const aliases = {
    '/issues': '/board',
    '/roadmap': '/build',
    '/gallery': '/atlas',
    '/models': '/atlas',
    '/characters': '/atlas',
  };
  return { ...route, path: aliases[route.path] || route.path };
}

function App() {
  const [route, setRoute] = useState(normalizeRoute(getHashRoute()));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onHashChange = () => setRoute(normalizeRoute(getHashRoute()));
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', '#/');
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      loadSiteData()
        .then((payload) => { if (!cancelled) setData(payload); })
        .catch((err) => { if (!cancelled) setError(err.message); });
    };
    reload();
    if (import.meta.env.DEV) {
      const onFocus = () => reload();
      window.addEventListener('focus', onFocus);
      return () => {
        cancelled = true;
        window.removeEventListener('focus', onFocus);
      };
    }
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="boot-state error"><h1>Unable to load resort data</h1><p>{error}</p></div>;
  if (!data) return <div className="boot-state"><span className="loader" /><p>Opening the resort…</p></div>;

  const Page = pages[route.path] || Home;
  return (
    <>
      <LegalBanner site={data.site} />
      <Header site={data.site} route={route.path} />
      <Page data={data} query={route.query} />
      <Footer site={data.site} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
