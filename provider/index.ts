import { Client } from 'elasticsearch';
import * as HttpAwsEs from 'http-aws-es';

const getClient = (domainEndpoint: string): Client => {
    return new Client({
        hosts: [`https://${domainEndpoint}`],
        connectionClass: HttpAwsEs,
    });
};

interface ResourceProperties {
    OpensearchDomainEndpoint: string;
    ClusterSettingsJson: string;
}

type RequestType = 'Create' | 'Update' | 'Delete';

interface BaseEvent {
    RequestType: RequestType;
}

interface CreateEvent extends BaseEvent {
    ResourceProperties: ResourceProperties;
}

interface UpdateEvent extends CreateEvent {
    PhysicalResourceId: string;
}

interface DeleteEvent extends BaseEvent {
    PhysicalResourceId: string;
}

interface Response {
    PhysicalResourceId: string;
    Data: {};
}

type Event = CreateEvent | UpdateEvent | DeleteEvent;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ElasticsearchClusterSettings = Record<string, any>;

const handleCreate = async (event: CreateEvent): Promise<Response> => {
    const opensearchDomainEndpoint = event.ResourceProperties.OpensearchDomainEndpoint;
    const clusterSettings = JSON.parse(event.ResourceProperties.ClusterSettingsJson) as ElasticsearchClusterSettings;

    try {
        console.log('opensearchdomainendpoint', opensearchDomainEndpoint);
        console.log('clusterSettings', JSON.stringify(clusterSettings, null, 2));

        const client = getClient(opensearchDomainEndpoint);
        const result = await client.cluster.putSettings({
            body: {
                persistent: clusterSettings,
            },
        });

        console.log('result', JSON.stringify(result, null, 2));
    } catch (err) {
        console.error(err);
    }

    return Promise.resolve({
        PhysicalResourceId: `settings_${opensearchDomainEndpoint}`,
        Data: {},
    });
};

const handleUpdate = async (event: UpdateEvent): Promise<Response> => {
    const physicalResourceId = event.PhysicalResourceId;
    const response = await handleCreate(event as CreateEvent);
    return Promise.resolve({
        ...response,
        PhysicalResourceId: physicalResourceId,
    });
};

const handleDelete = async (event: DeleteEvent): Promise<Response> => {
    return Promise.resolve({
        PhysicalResourceId: event.PhysicalResourceId,
        Data: {},
    });
};

export const onEvent = (event: Event): Promise<Response> => {
    try {
        const eventType = event.RequestType as string;
        switch (eventType) {
            case 'Create':
                return handleCreate(event as CreateEvent);
            case 'Update':
                return handleUpdate(event as UpdateEvent);
            case 'Delete':
                return handleDelete(event as DeleteEvent);
        }
        return Promise.reject(`Unknown event type ${eventType}`);
    } catch (err) {
        console.error(err);
        return Promise.reject('Failed');
    }
};
