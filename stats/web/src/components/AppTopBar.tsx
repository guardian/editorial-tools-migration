import { TopBar, TopBarToolName } from '@guardian/stand/TopBar';

const AppTopBar: React.FunctionComponent = () => (
  <TopBar collapseBelow={{ toolName: 'sm' }}>
    <TopBarToolName name="Migration Stats" favicon={{ icon: 'query_stats' }} />
  </TopBar>
);

export { AppTopBar };
