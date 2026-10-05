import { Typography } from '@guardian/stand/Typography';
import { AlertBanner } from '@guardian/stand/AlertBanner';
import { PlatformBadge } from './components/PlatformBadge.tsx';
import RepoProgressChart from './RepoProgressChart.tsx';
import type { AppStats } from './App.tsx';

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
        <RepoProgressChart repo={repo} />
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
