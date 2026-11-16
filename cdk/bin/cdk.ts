import 'source-map-support/register';
import { GuRoot } from '@guardian/cdk/lib/constructs/root';
import { FeatureLibrary } from '../lib/feature-library';

const app = new GuRoot();
new FeatureLibrary(app, 'FeatureLibrary-euwest-1-CODE', {
	stack: 'workflow',
	stage: 'CODE',
	env: { region: 'eu-west-1' },
	domainName: 'feature-library.code.dev-gutools.co.uk',
});
new FeatureLibrary(app, 'FeatureLibrary-euwest-1-PROD', {
	stack: 'workflow',
	stage: 'PROD',
	env: { region: 'eu-west-1' },
	domainName: 'feature-library.gutools.co.uk',
});
