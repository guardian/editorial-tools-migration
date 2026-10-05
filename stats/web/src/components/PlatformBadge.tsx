import { Badge } from '@guardian/stand/Badge';
import type { BadgeProps } from '@guardian/stand/Badge';

type PlatformBadgeProps = {
  platform: string;
};

// Stand has no blue badge, so Knockout (legacy accent blue) maps to warmPurple
// and Angular (legacy red) to red; anything else falls back to grey.
const PLATFORM_COLORS: Record<string, BadgeProps['color']> = {
  Angular: 'red',
  Knockout: 'warmPurple',
};

const PlatformBadge: React.FunctionComponent<PlatformBadgeProps> = ({ platform }) => (
  <Badge size="sm" color={PLATFORM_COLORS[platform] ?? 'grey'}>
    {platform}
  </Badge>
);

export { PlatformBadge };
