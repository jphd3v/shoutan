import { requireOptionalNativeModule } from 'expo';

/** Null where the module isn't built in: on iOS, in tests, in Expo Go. */
const native = requireOptionalNativeModule<{ onTestLab: boolean }>('TestLab');

/** On Google's test devices, where the pre-launch crawler signs in with made-up email addresses. */
export const onTestLab = native?.onTestLab ?? false;
