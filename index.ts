import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as cdk from 'aws-cdk-lib';
import * as customResource from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenSearchClusterSettings = Record<string, any>;

export interface OpenSearchSettingsProps {
    readonly domain: opensearch.IDomain;
    readonly clusterSettings: OpenSearchClusterSettings;
    readonly vpc?: ec2.IVpc;
    readonly vpcSubnets?: ec2.SubnetSelection;
}

interface OpenSearchSettingsProviderProps {
    readonly vpc?: ec2.IVpc;
    readonly vpcSubnets?: ec2.SubnetSelection;
}

class OpenSearchSettingsProvider extends Construct {
    public readonly provider: customResource.Provider;
    public readonly lambdaFunction: lambda.Function;
    public readonly securityGroup?: ec2.ISecurityGroup;

    public static getOrCreate(scope: Construct, props?: OpenSearchSettingsProviderProps): OpenSearchSettingsProvider {
        const stack = cdk.Stack.of(scope);
        // Create a unique ID based on VPC configuration to allow multiple providers with different VPC settings
        const vpcId = props?.vpc ? `-${props.vpc.node.addr}` : '';
        const id = `com.isotoma.cdk.custom-resources.opensearch-settings${vpcId}`;
        const existing = (stack.node.tryFindChild(id) as OpenSearchSettingsProvider) || new OpenSearchSettingsProvider(stack, id, props);
        return existing;
    }

    constructor(scope: Construct, id: string, props?: OpenSearchSettingsProviderProps) {
        super(scope, id);

        const lambdaProps: lambda.FunctionProps = {
            code: lambda.Code.fromAsset(path.join(__dirname, 'provider')),
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.onEvent',
            timeout: cdk.Duration.minutes(5),
        };

        // Add VPC configuration if provided
        if (props?.vpc) {
            // Create a security group for the Lambda function
            this.securityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
                vpc: props.vpc,
                description: 'Security group for OpenSearch Settings Lambda function',
                allowAllOutbound: false,
            });

            // Add egress rule to allow Lambda to connect to OpenSearch on port 443 (HTTPS)
            this.securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS access to OpenSearch domain');

            // Default to PRIVATE_WITH_EGRESS subnets if not specified
            const vpcSubnets = props.vpcSubnets || { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

            Object.assign(lambdaProps, {
                vpc: props.vpc,
                vpcSubnets: vpcSubnets,
                securityGroups: [this.securityGroup],
            });
        }

        this.lambdaFunction = new lambda.Function(this, 'opensearch-settings-event', lambdaProps);

        this.provider = new customResource.Provider(this, 'opensearch-settings-provider', {
            onEventHandler: this.lambdaFunction,
        });
    }
}

export class OpenSearchSettings extends Construct {
    constructor(scope: Construct, id: string, props: OpenSearchSettingsProps) {
        super(scope, id);

        const settingsProvider = OpenSearchSettingsProvider.getOrCreate(this, {
            vpc: props.vpc,
            vpcSubnets: props.vpcSubnets,
        });

        settingsProvider.lambdaFunction.addToRolePolicy(
            new iam.PolicyStatement({
                resources: [props.domain.domainArn, `${props.domain.domainArn}/*`],
                actions: ['es:ESHttp*'],
            }),
        );

        new cdk.CustomResource(this, 'Resource', {
            serviceToken: settingsProvider.provider.serviceToken,
            resourceType: 'Custom::OpenSearchSettings',
            properties: {
                OpensearchDomainEndpoint: props.domain.domainEndpoint,
                ClusterSettingsJson: JSON.stringify(props.clusterSettings),
            },
        });
    }
}
