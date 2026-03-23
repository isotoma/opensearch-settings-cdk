import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as opensearch from 'aws-cdk-lib/aws-opensearch';
import * as cdk from 'aws-cdk-lib';
import * as customResource from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElasticsearchClusterSettings = Record<string, any>;

export interface ElasticsearchSettingsProps {
    readonly domain: opensearch.IDomain;
    readonly clusterSettings: ElasticsearchClusterSettings;
}

class ElasticsearchSettingsProvider extends Construct {
    public readonly provider: customResource.Provider;

    public static getOrCreate(scope: Construct): customResource.Provider {
        const stack = cdk.Stack.of(scope);
        const id = 'com.isotoma.cdk.custom-resources.es-settings';
        const x = (stack.node.tryFindChild(id) as ElasticsearchSettingsProvider) || new ElasticsearchSettingsProvider(stack, id);
        return x.provider;
    }

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.provider = new customResource.Provider(this, 'es-settings-provider', {
            onEventHandler: new lambda.Function(this, 'es-settings-event', {
                code: lambda.Code.fromAsset(path.join(__dirname, 'provider')),
                runtime: lambda.Runtime.NODEJS_20_X,
                handler: 'index.onEvent',
                timeout: cdk.Duration.minutes(5),
                initialPolicy: [
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['es:ESHttp*'],
                    }),
                ],
            }),
        });
    }
}

export class ElasticsearchSettings extends Construct {
    constructor(scope: Construct, id: string, props: ElasticsearchSettingsProps) {
        super(scope, id);

        const provider = ElasticsearchSettingsProvider.getOrCreate(this);

        new cdk.CustomResource(this, 'Resource', {
            serviceToken: provider.serviceToken,
            resourceType: 'Custom::ElasticsearchSettings',
            properties: {
                OpensearchDomainEndpoint: props.domain.domainEndpoint,
                ClusterSettingsJson: JSON.stringify(props.clusterSettings),
            },
        });
    }
}
