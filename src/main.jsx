import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loadResortData, assetUrl } from './lib/data.js';
import { LegalBanner } from './components/LegalBanner.jsx';
import { Hero } from './components/Hero.jsx';
import { FrontDesk } from './components/FrontDesk.jsx';
import { IslandAtlas } from './components/IslandAtlas.jsx';
import { CompatibilityLab } from './components/CompatibilityLab.jsx';
import { FlightBoard } from './components/FlightBoard.jsx';
import { IssueDesk } from './components/IssueDesk.jsx';
import { SourceGuide } from './components/SourceGuide.jsx';
import { Footer } from './components/Footer.jsx';

function applyTheme(theme) {
  if (!theme?.customProperties) return;
  Object.entries(theme.customProperties).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
  document.documentElement.dataset.motion = theme.motion || 'gentle';
  document.documentElement.dataset.hero = theme.heroStyle || 'cinematic';
  document.documentElement.dataset.density = theme.cardDensity || 'comfortable';
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadResortData()
      .then((payload) => {
        setData(payload);
        applyTheme(payload.theme);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || 'Unable to load resort data.');
      });
  }, []);

  const pulse = useMemo(() => {
    if (!data) return [];
    const openBugs = data.bugs.items.filter((bug) => ['open', 'blocked'].includes(bug.status)).length;
    const onFlight = data.features.items.filter((item) => item.stage === 'on-flight').length;
    const testingRoutes = data.compatibility.routes.filter((route) => route.status === 'testing').length;
    return [
      `${openBugs} open or blocked issues at the Issue Desk.`,
      `${onFlight} features currently on-flight.`,
      `${testingRoutes} transfer routes need more tests.`,
      ...(data.homepage.weeklyPulse || [])
    ];
  }, [data]);

  if (error) {
    return (
      <main className="load-shell">
        <div className="load-card">
          <h1>Resort data could not load.</h1>
          <p>{error}</p>
          <p>Check that the JSON files in <code>public/data</code> are valid.</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="load-shell">
        <div className="load-card shimmer-card">
          <span className="loader-orb" />
          <h1>Preparing the resort...</h1>
          <p>Loading research, features, and compatibility data.</p>
        </div>
      </main>
    );
  }

  return (
    <>
      <LegalBanner legal={data.site.legal} />
      <header className="site-header">
        <a href="#top" className="brand-link" aria-label="Pokémon Resort home">
          <img src={assetUrl(data.homepage.hero.logo)} alt="Pokémon Resort" />
        </a>
        <nav className="site-nav" aria-label="Primary navigation">
          {data.site.navigation.map((item) => (
            <a key={item.href} href={item.href}>{item.label}</a>
          ))}
        </nav>
      </header>
      <main id="top">
        <Hero site={data.site} homepage={data.homepage} pulse={pulse} />
        <FrontDesk data={data} />
        <IslandAtlas atlas={data.atlas} features={data.features} bugs={data.bugs} />
        <CompatibilityLab compatibility={data.compatibility} bugs={data.bugs} />
        <FlightBoard features={data.features} bugs={data.bugs} atlas={data.atlas} />
        <IssueDesk bugs={data.bugs} features={data.features} compatibility={data.compatibility} />
        <SourceGuide site={data.site} />
      </main>
      <Footer legal={data.site.legal} site={data.site} />
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
