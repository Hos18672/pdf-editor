# Google's document scanner (ML Kit) finds its parts by reflection: the release build's shrinker must
# keep them, or the scanner fails to start (MlKitContext missing) and takes the app down.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep class com.google.android.gms.common.internal.** { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.firebase.components.** { *; }
-dontwarn com.google.mlkit.**
