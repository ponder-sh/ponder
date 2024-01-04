import { E_CANCELED, Mutex } from "async-mutex";
import _Emittery, {
  type DatalessEventNames,
  type EventName,
  type OmnipresentEventData,
  type UnsubscribeFunction,
} from "emittery";

export class Emittery<
  EventData = Record<EventName, any>,
  AllEventData = EventData & OmnipresentEventData,
  DatalessEvents = DatalessEventNames<EventData>,
> extends _Emittery<EventData, AllEventData, DatalessEvents> {
  private listenerMutexes: Map<
    EventName,
    Map<
      (eventData: AllEventData[any]) => void | Promise<void>,
      { mutex: Mutex; latestEventData: any; unsubscribe: UnsubscribeFunction }
    >
  > = new Map();

  onSerial<Name extends keyof AllEventData>(
    eventName: Name,
    listener: (eventData: AllEventData[Name]) => void | Promise<void>,
  ): UnsubscribeFunction {
    // If this is the first listener being registered for this event, create the listener map.
    if (!this.listenerMutexes.has(eventName))
      this.listenerMutexes.set(eventName, new Map());

    // If the listener has already been registered, return the existing unsubscribe function.
    if (this.listenerMutexes.get(eventName)!.has(listener))
      return this.listenerMutexes.get(eventName)!.get(listener)!.unsubscribe;

    const innerListener = async (eventData: AllEventData[Name]) => {
      const eventMutex = this.listenerMutexes.get(eventName)!.get(listener)!;

      eventMutex.latestEventData = eventData;

      try {
        await eventMutex.mutex.runExclusive(async () => {
          if (eventMutex.latestEventData === undefined) return;

          const toProcess = eventMutex.latestEventData;
          eventMutex.latestEventData = undefined;

          await listener(toProcess);
        });
      } catch (error) {
        // Pending locks get cancelled in cancelMutexes(). This is expected, so it's safe to
        // ignore the error that is thrown when a pending lock is cancelled.
        if (error !== E_CANCELED) throw error;
      }
    };

    const unsubscribe = super.on(eventName, innerListener);

    this.listenerMutexes.get(eventName)!.set(listener, {
      mutex: new Mutex(),
      latestEventData: undefined,
      unsubscribe,
    });

    return unsubscribe;
  }

  cancelMutexes() {
    for (const [, listenerMap] of this.listenerMutexes) {
      for (const [, { mutex }] of listenerMap) {
        mutex.cancel();
      }
    }
  }
}
