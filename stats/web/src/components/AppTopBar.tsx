import { TopBar, TopBarToolName, TopBarContainerLeft, TopBarNavigation } from '@guardian/stand/TopBar';
import { MenuSection, MenuItem } from '@guardian/stand/Menu';

const REPOS = ['Workflow', 'Grid', 'Restorer', 'Fronts', 'Story Packages'];

type RepoProgress = { name: string; percent: number };

type AppTopBarProps = {
  repos?: RepoProgress[];
};

const MiniProgress: React.FunctionComponent<{ percent: number }> = ({ percent }) => (
  <span className="menu-progress" title={`${percent.toFixed(1)}% migrated`}>
    <span className="menu-progress-track">
      <span
        className="menu-progress-fill"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
    <span className="menu-progress-label">{percent.toFixed(0)}%</span>
  </span>
);

const AppTopBar: React.FunctionComponent<AppTopBarProps> = ({ repos = [] }) => {
  const percentByName = new Map(repos.map((r) => [r.name, r.percent]));
  return (
    <TopBar collapseBelow={{ toolName: 'sm' }}>
      <TopBarToolName name="Migration Stats" favicon={{ icon: 'query_stats' }} href="#" hoverText="Back to overview" collapsedHoverText="Back"  />
      <TopBarContainerLeft>
        <TopBarNavigation
          text="Repositories"
          menuChildren={
            <MenuSection name="Repositories">
              {REPOS.map((repo) => {
                const percent = percentByName.get(repo);
                return (
                  <MenuItem
                    key={repo}
                    label={repo}
                    href={`#/repo/${encodeURIComponent(repo)}`}
                    aside={percent != null ? <MiniProgress percent={percent} /> : undefined}
                  />
                );
              })}
            </MenuSection>
          }
        />
      </TopBarContainerLeft>
    </TopBar>
  );
};

export { AppTopBar };
