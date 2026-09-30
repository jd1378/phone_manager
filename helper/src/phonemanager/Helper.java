package phonemanager;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.app.usage.StorageStats;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Runs on the phone through app_process as the adb shell user. Prints package metadata that
 * `pm` cannot provide (labels, icons, signers, permission types) as JSON, one object per line.
 *
 * Usage: app_process / phonemanager.Helper list [iconSizePx] | info <package> | sizes <userId>
 */
public final class Helper {
    private static final int MATCH_UNINSTALLED = 0x00002000; // PackageManager.MATCH_UNINSTALLED_PACKAGES
    private static final int MATCH_DISABLED = 0x00000200 | 0x00008000; // MATCH_DISABLED_COMPONENTS | ..._UNTIL_USED_

    private static final Map<String, Boolean> runtimePermissionCache = new HashMap<>();

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(
                new BufferedOutputStream(new FileOutputStream(FileDescriptor.out), 1 << 16), false, "UTF-8");
        try {
            PackageManager pm = systemContext().getPackageManager();
            String command = args.length > 0 ? args[0] : "";
            if (command.equals("list")) {
                int iconSize = args.length > 1 ? Integer.parseInt(args[1]) : 0;
                list(pm, iconSize, out);
            } else if (command.equals("info") && args.length > 1) {
                out.println(info(pm, args[1]));
            } else if (command.equals("sizes") && args.length > 1) {
                sizes(pm, Integer.parseInt(args[1]), out);
            } else {
                System.err.println("usage: list [iconSizePx] | info <package> | sizes <userId>");
                System.exit(2);
            }
        } catch (PackageManager.NameNotFoundException e) {
            System.err.println("not-found: " + e.getMessage());
            System.exit(3);
        } finally {
            out.flush();
        }
    }

    /** app_process gives no Context; build the system one like scrcpy's server does. */
    private static Context systemContext() throws Exception {
        try {
            Looper.prepareMainLooper();
        } catch (IllegalStateException ignored) {
            // already prepared
        }
        Class<?> activityThreadClass = Class.forName("android.app.ActivityThread");
        Constructor<?> constructor = activityThreadClass.getDeclaredConstructor();
        constructor.setAccessible(true);
        Object activityThread = constructor.newInstance();
        Field current = activityThreadClass.getDeclaredField("sCurrentActivityThread");
        current.setAccessible(true);
        current.set(null, activityThread);
        return (Context) activityThreadClass.getDeclaredMethod("getSystemContext").invoke(activityThread);
    }

    private static void list(PackageManager pm, int iconSize, PrintStream out) throws JSONException {
        Set<String> launchable = launchablePackages(pm);
        List<PackageInfo> packages = pm.getInstalledPackages(MATCH_UNINSTALLED | PackageManager.GET_PERMISSIONS);
        for (PackageInfo pkg : packages) {
            JSONObject json = summary(pm, pkg, launchable);
            if (iconSize > 0) {
                String icon = iconPng(pm, pkg.applicationInfo, iconSize);
                if (icon != null) json.put("icon", icon);
            }
            out.println(json);
        }
    }

    /**
     * StorageStatsManager built from our Context would report the wrong calling package, so talk to the
     * service binder directly as com.android.shell, which holds PACKAGE_USAGE_STATS.
     */
    private static void sizes(PackageManager pm, int userId, PrintStream out) throws Exception {
        IBinder binder = (IBinder) Class.forName("android.os.ServiceManager")
                .getMethod("getService", String.class).invoke(null, "storagestats");
        Object service = Class.forName("android.app.usage.IStorageStatsManager$Stub")
                .getMethod("asInterface", IBinder.class).invoke(null, binder);
        Method query = service.getClass().getMethod(
                "queryStatsForPackage", String.class, String.class, int.class, String.class);
        for (PackageInfo pkg : pm.getInstalledPackages(0)) {
            try {
                StorageStats stats = (StorageStats) query.invoke(service, null, pkg.packageName, userId, "com.android.shell");
                out.println(new JSONObject()
                        .put("packageName", pkg.packageName)
                        .put("appBytes", stats.getAppBytes())
                        .put("dataBytes", stats.getDataBytes() - stats.getCacheBytes())
                        .put("cacheBytes", stats.getCacheBytes()));
            } catch (Exception ignored) {
                // not installed for this user, or stats unavailable
            }
        }
    }

    private static JSONObject info(PackageManager pm, String packageName) throws Exception {
        int signingFlag = Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo pkg = pm.getPackageInfo(
                packageName, PackageManager.GET_PERMISSIONS | MATCH_UNINSTALLED | signingFlag);
        ApplicationInfo app = pkg.applicationInfo;
        JSONObject json = summary(pm, pkg, launchablePackages(pm));
        json.put("uid", app.uid);
        json.put("installer", installer(pm, packageName));
        json.put("dataDir", app.dataDir);

        JSONArray paths = new JSONArray().put(app.sourceDir);
        if (app.splitSourceDirs != null) {
            for (String split : app.splitSourceDirs) paths.put(split);
        }
        json.put("apkPaths", paths);

        JSONArray signers = new JSONArray();
        for (Signature signature : signatures(pkg)) signers.put(sha256(signature.toByteArray()));
        json.put("signers", signers);

        JSONArray permissions = new JSONArray();
        if (pkg.requestedPermissions != null) {
            for (int i = 0; i < pkg.requestedPermissions.length; i++) {
                String name = pkg.requestedPermissions[i];
                int flags = pkg.requestedPermissionsFlags != null ? pkg.requestedPermissionsFlags[i] : 0;
                permissions.put(new JSONObject()
                        .put("name", name)
                        .put("granted", (flags & PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0)
                        .put("runtime", isRuntimePermission(pm, name)));
            }
        }
        json.put("permissionDetails", permissions);
        return json;
    }

    private static JSONObject summary(PackageManager pm, PackageInfo pkg, Set<String> launchable)
            throws JSONException {
        ApplicationInfo app = pkg.applicationInfo;
        JSONObject json = new JSONObject();
        json.put("packageName", pkg.packageName);
        json.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pkg.getLongVersionCode() : pkg.versionCode);
        json.put("versionName", pkg.versionName == null ? JSONObject.NULL : pkg.versionName);
        json.put("label", label(pm, app));
        json.put("minSdk", Build.VERSION.SDK_INT >= 24 ? app.minSdkVersion : JSONObject.NULL);
        json.put("targetSdk", app.targetSdkVersion);
        json.put("firstInstallTime", pkg.firstInstallTime);
        json.put("lastUpdateTime", pkg.lastUpdateTime);
        json.put("updatedSystem", (app.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0);
        json.put("debuggable", (app.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        json.put("splitCount", app.splitSourceDirs == null ? 0 : app.splitSourceDirs.length);
        json.put("launchable", launchable.contains(pkg.packageName));

        JSONArray requested = new JSONArray();
        JSONArray grantedRuntime = new JSONArray();
        if (pkg.requestedPermissions != null) {
            for (int i = 0; i < pkg.requestedPermissions.length; i++) {
                String name = pkg.requestedPermissions[i];
                requested.put(name);
                int flags = pkg.requestedPermissionsFlags != null ? pkg.requestedPermissionsFlags[i] : 0;
                if ((flags & PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0 && isRuntimePermission(pm, name)) {
                    grantedRuntime.put(name);
                }
            }
        }
        json.put("permissions", requested);
        json.put("grantedRuntimePermissions", grantedRuntime);
        return json;
    }

    private static String label(PackageManager pm, ApplicationInfo app) {
        try {
            CharSequence label = app.loadLabel(pm);
            if (label != null && label.length() > 0) return label.toString();
        } catch (RuntimeException ignored) {
            // broken resources; fall back to the package name
        }
        return app.packageName;
    }

    private static Set<String> launchablePackages(PackageManager pm) {
        Intent intent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        Set<String> result = new HashSet<>();
        for (ResolveInfo info : pm.queryIntentActivities(intent, MATCH_DISABLED)) {
            result.add(info.activityInfo.packageName);
        }
        return result;
    }

    private static String iconPng(PackageManager pm, ApplicationInfo app, int size) {
        try {
            Drawable drawable = app.loadIcon(pm);
            Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            drawable.setBounds(0, 0, size, size);
            drawable.draw(new Canvas(bitmap));
            ByteArrayOutputStream png = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
            bitmap.recycle();
            return Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Object installer(PackageManager pm, String packageName) {
        try {
            String name = Build.VERSION.SDK_INT >= 30
                    ? pm.getInstallSourceInfo(packageName).getInstallingPackageName()
                    : pm.getInstallerPackageName(packageName);
            return name == null ? JSONObject.NULL : name;
        } catch (Exception e) {
            return JSONObject.NULL;
        }
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signatures(PackageInfo pkg) {
        if (Build.VERSION.SDK_INT >= 28 && pkg.signingInfo != null) {
            Signature[] signers = pkg.signingInfo.getApkContentsSigners();
            if (signers != null) return signers;
        }
        return pkg.signatures != null ? pkg.signatures : new Signature[0];
    }

    @SuppressWarnings("deprecation")
    private static boolean isRuntimePermission(PackageManager pm, String name) {
        Boolean cached = runtimePermissionCache.get(name);
        if (cached != null) return cached;
        boolean runtime;
        try {
            PermissionInfo info = pm.getPermissionInfo(name, 0);
            runtime = (info.protectionLevel & PermissionInfo.PROTECTION_MASK_BASE)
                    == PermissionInfo.PROTECTION_DANGEROUS;
        } catch (PackageManager.NameNotFoundException e) {
            runtime = false;
        }
        runtimePermissionCache.put(name, runtime);
        return runtime;
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte b : digest) hex.append(String.format("%02x", b & 0xff));
        return hex.toString();
    }
}
