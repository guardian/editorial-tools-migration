import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { FeatureLibrary } from './feature-library';

describe('The FeatureLibrary stack', () => {
	it('matches the snapshot', () => {
		const app = new App();
		const stack = new FeatureLibrary(app, 'FeatureLibrary', {
			stack: 'workflow',
			stage: 'CODE',
			env: { region: 'eu-west-1' },
			domainName: 'feature-library.code.dev-gutools.co.uk',
		});
		const template = Template.fromStack(stack);
		expect(template.toJSON()).toMatchSnapshot();
	});
});
