ThisBuild / scalaVersion := "3.10.0"
ThisBuild / organization := "com.gu"

lazy val root = (project in file("."))
  .enablePlugins(PlayScala, JDebPackaging, SystemdPlugin)
  .settings(
    name := "feature-library",
    version := "1.0.0",
    // -unchecked, -deprecation and -encoding are already added by the PlayScala plugin
    scalacOptions ++= Seq("-feature"),
    libraryDependencies ++= Seq(
      "org.scalatestplus.play" %% "scalatestplus-play" % "7.0.2" % Test
    ),
    Universal / javaOptions ++= Seq("-Dpidfile.path=/dev/null"),
    Compile / doc / sources := Seq.empty,
    Compile / packageDoc / publishArtifact := false,
    debianPackageDependencies := Seq("java25-runtime-headless"),
    maintainer := "Digital CMS <digitalcms.dev@guardian.co.uk>",
    packageSummary := "feature-library",
    packageDescription := "Feature library for editorial tools"
  )
