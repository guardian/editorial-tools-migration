import { Typography } from '@guardian/stand/Typography';
import { AlertBanner } from '@guardian/stand/AlertBanner';
import { PlatformBadge } from './components/PlatformBadge.tsx';
import RepoProgressChart from './RepoProgressChart.tsx';
import {
  MIGRATED_CATEGORY,
  TO_MIGRATE_CATEGORIES,
  formatNumber,
  type AppStats,
} from './App.tsx';

type RepoDetailProps = {
  name: string;
  repo: AppStats | undefined;
};

export default function RepoDetail({ name, repo }: RepoDetailProps) {
  return (
    <main className="container">
      <p className="back-link">
        <a href="#/">&larr; Back to overview</a>
      </p>

      <header>
        <Typography element="h1" variant="headingLg">
          {name}
        </Typography>
        {repo && (
          <div className="subtitle">
            <PlatformBadge platform={repo.platform} />
          </div>
        )}
      </header>

      {repo ? (
        <>
          <RepoProgressChart repo={repo} />

          <section>
            <Typography element="h2" variant="headingMd">
              Breakdown by category
            </Typography>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Lines</th>
                </tr>
              </thead>
              <tbody>
                {TO_MIGRATE_CATEGORIES.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="num">{formatNumber(repo.categories[c] || 0)}</td>
                  </tr>
                ))}
                <tr>
                  <td>{MIGRATED_CATEGORY}</td>
                  <td className="num migrated-cell">
                    {formatNumber(repo.categories[MIGRATED_CATEGORY] || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <AlertBanner level="warning">
          <Typography element="p" variant="bodyMd">
            No data found for repository “{name}”.
          </Typography>
        </AlertBanner>
      )}
    </main>
  );
}
