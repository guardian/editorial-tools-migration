import { TopBar, TopBarToolName, TopBarContainerLeft, TopBarNavigation } from '@guardian/stand/TopBar';
import { MenuSection, MenuItem } from '@guardian/stand/Menu';

const REPOS = ['Workflow', 'Grid', 'Restorer', 'Fronts', 'Story Packages'];

const AppTopBar: React.FunctionComponent = () => (
  <TopBar collapseBelow={{ toolName: 'sm' }}>
    <TopBarToolName name="Migration Stats" favicon={{ icon: 'query_stats' }} href="#" hoverText="Back to overview" collapsedHoverText="Back"  />
    <TopBarContainerLeft>
      <TopBarNavigation
        text="Repositories"
        menuChildren={
          <MenuSection name="Repositories">
            {REPOS.map((repo) => (
              <MenuItem key={repo} label={repo} href={`#/repo/${encodeURIComponent(repo)}`} />
            ))}
          </MenuSection>
        }
      />
    </TopBarContainerLeft>
  </TopBar>
);

export { AppTopBar };
