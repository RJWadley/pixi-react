import {
    Container,
    Graphics,
} from 'pixi.js';
import {
    type FederatedPointerEvent,
    type FederatedWheelEvent,
} from 'pixi.js';
import {
    PixiToReactEventPropNames,
    ReactToPixiEventPropNames,
} from '../constants/EventPropNames';
import { type DiffSet } from '../typedefs/DiffSet';
import { type HostConfig } from '../typedefs/HostConfig';
import { type InstanceState } from '../typedefs/InstanceState';
import {
    isNull,
    isUndefined,
} from './compare';
import { diffProps } from './diffProps';
import { isDiffSet } from './isDiffSet';
import { isReadOnlyProperty } from './isReadOnlyProperty';
import { log } from './log';

const DEFAULT = '__default';
const DEFAULTS_CONTAINERS = new Map();

const PIXI_EVENT_PROP_NAME_ERROR_HAS_BEEN_SHOWN: Record<string, boolean> = {};

export type MaybeInstance = Partial<HostConfig['instance']>;

function targetKeyReducer(accumulator: any, key: string)
{
    if (accumulator)
    {
        const value = accumulator[key];

        if (!isUndefined(value) && !isNull(value))
        {
            return value;
        }
    }

    return accumulator;
}

/** Apply properties to Pixi.js instance. */
export function applyProps(
    instance: MaybeInstance,
    data: HostConfig['props'] | DiffSet,
)
{
    const {
        __pixireact: instanceState = {} as InstanceState,
        ...instanceProps
    } = instance;

    let typedData;

    if (isDiffSet(data))
    {
        typedData = data as DiffSet;
    }
    else
    {
        typedData = diffProps(data, instanceProps as HostConfig['props']);
    }

    const { changes } = typedData;

    let changeIndex = 0;

    while (changeIndex < changes.length)
    {
        const change = changes[changeIndex];
        let hasError = false;
        let key = change[0] as keyof HostConfig['instance'];
        let value = change[1];
        const isEvent = change[2];

        const keys = change[3];

        let currentInstance = instance;
        let targetProp = currentInstance[key];

        if ((key as string === 'draw') && (typeof value === 'function'))
        {
            if (instance instanceof Graphics)
            {
                value(instance);
            }
            else
            {
                hasError = true;
                log('warn', `The \`draw\` prop was used on a \`${instanceState.type}\` component, but it's only valid on \`graphics\` components.`);
            }
        }

        if (key in PixiToReactEventPropNames)
        {
            const typedKey = key as keyof typeof PixiToReactEventPropNames;

            hasError = true;

            if (!PIXI_EVENT_PROP_NAME_ERROR_HAS_BEEN_SHOWN[key])
            {
                PIXI_EVENT_PROP_NAME_ERROR_HAS_BEEN_SHOWN[key] = true;

                log('warn', `Event names must be pascal case; instead of \`${key}\`, you probably want \`${PixiToReactEventPropNames[typedKey]}\`.`);
            }
        }

        if (!hasError)
        {
            // Resolve dashed props
            if (keys.length)
            {
                targetProp = keys.reduce(targetKeyReducer, currentInstance);

                // If the target is atomic, it forces us to switch the root
                if (!(targetProp && (targetProp as unknown as Record<string, unknown>).set))
                {
                    const [name, ...reverseEntries] = keys.reverse();

                    currentInstance = reverseEntries.reverse().reduce(targetKeyReducer, currentInstance);

                    key = name as keyof MaybeInstance;
                }
            }

            // https://github.com/mrdoob/three.js/issues/21209
            // HMR/fast-refresh relies on the ability to cancel out props, but pixi.js
            // has no means to do this. Hence we curate a small collection of value-classes
            // with their respective constructor/set arguments
            // For removed props, try to set default values, if possible
            if (value === `${DEFAULT}remove`)
            {
                if (currentInstance instanceof Container)
                {
                    // create a blank slate of the instance and copy the particular parameter.
                    let ctor = DEFAULTS_CONTAINERS.get(currentInstance.constructor);

                    if (!ctor)
                    {
                        ctor = currentInstance.constructor;

                        // eslint-disable-next-line new-cap
                        ctor = new ctor();

                        DEFAULTS_CONTAINERS.set(currentInstance.constructor, ctor);
                    }

                    value = ctor[key];
                }
                else
                {
                    // instance does not have constructor, just set it to 0
                    value = 0;
                }
            }

            // Deal with events ...
            if (isEvent && instanceState)
            {
                const typedKey = key as keyof typeof ReactToPixiEventPropNames;
                const pixiKey = ReactToPixiEventPropNames[typedKey];

                if (value)
                {
                    currentInstance[pixiKey] = value as (event: FederatedPointerEvent | FederatedWheelEvent) => void;
                }
                else
                {
                    delete currentInstance[pixiKey];
                }
            }
            else if (!isReadOnlyProperty(currentInstance as Record<string, unknown>, key))
            {
                // @ts-expect-error Typescript is grumpy because this could be setting a readonly key, but we're already handling that in the conditional above. 🤷🏻‍♂️
                currentInstance[key] = value;
            }
        }

        changeIndex += 1;
    }

    return instance;
}
