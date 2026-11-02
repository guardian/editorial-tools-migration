import org.scalatestplus.play.PlaySpec
import org.scalatestplus.play.components.OneAppPerSuiteWithComponents
import play.api.BuiltInComponents
import play.api.test.FakeRequest
import play.api.test.Helpers.*

// In the root package so it can see AppComponents, which lives in the empty package.
class ManagementSpec extends PlaySpec with OneAppPerSuiteWithComponents {
  override def components: BuiltInComponents = new AppComponents(context)

  "GET /management/healthcheck" should {
    "return 200 OK regardless of the Host header" in {
      val request = FakeRequest(GET, "/management/healthcheck").withHeaders(HOST -> "10.0.0.1")
      val result = route(app, request).value

      status(result) mustBe OK
      contentAsString(result) mustBe "OK"
    }
  }
}
